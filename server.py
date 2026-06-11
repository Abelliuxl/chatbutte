#!/usr/bin/env python3

import argparse
import ipaddress
import json
import os
import ssl
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib import error, parse, request


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


def create_ssl_context():
  if os.environ.get('CHATBUTTE_INSECURE_SSL') == '1':
    return ssl._create_unverified_context()
  try:
    import certifi
    return ssl.create_default_context(cafile=certifi.where())
  except ImportError:
    return ssl.create_default_context()


def json_response(handler, status_code, payload):
  body = json.dumps(payload).encode('utf-8')
  handler.send_response(status_code)
  handler.send_header('Content-Type', 'application/json; charset=utf-8')
  handler.send_header('Content-Length', str(len(body)))
  handler.send_header('Cache-Control', 'no-store')
  handler.end_headers()
  handler.wfile.write(body)


def extract_error_message(payload):
  if isinstance(payload, dict):
    if isinstance(payload.get('error'), dict) and payload['error'].get('message'):
      return payload['error']['message']
    if payload.get('message'):
      return str(payload['message'])
    if payload.get('code'):
      return str(payload['code'])
  return 'Upstream request failed.'


def is_private_hostname(hostname):
  if not hostname:
    return True
  if hostname in {'localhost', '127.0.0.1', '::1'}:
    return True
  try:
    ip = ipaddress.ip_address(hostname)
    return ip.is_private or ip.is_loopback or ip.is_link_local
  except ValueError:
    return False


def validate_target_url(raw_url):
  parsed = parse.urlparse(raw_url)
  if parsed.scheme != 'https':
    raise ValueError('Only https target URLs are allowed.')
  if is_private_hostname(parsed.hostname):
    raise ValueError('Private or local target hosts are not allowed.')
  return parsed.geturl()


def detect_provider(target_url, model):
  hostname = parse.urlparse(target_url).hostname or ''
  dashscope_hosts = {
    'dashscope.aliyuncs.com',
    'dashscope-intl.aliyuncs.com',
    'dashscope-us.aliyuncs.com',
  }
  if hostname in dashscope_hosts:
    return 'dashscope_multimodal'

  normalized_model = (model or '').lower()
  if normalized_model.startswith('z-image') or normalized_model.startswith('qwen-image') or normalized_model.startswith('wan'):
    return 'dashscope_multimodal'

  return 'openai_images'


def build_upstream_payload(provider, model, prompt, size):
  if provider == 'dashscope_multimodal':
    payload = {
      'model': model,
      'input': {
        'messages': [
          {
            'role': 'user',
            'content': [
              {
                'text': prompt,
              }
            ],
          }
        ],
      },
    }
    if size:
      payload['parameters'] = {
        'size': size.replace('x', '*'),
      }
    return payload

  payload = {
    'model': model,
    'prompt': prompt,
    'n': 1,
  }
  if size:
    payload['size'] = size
  return payload


def normalize_upstream_response(provider, payload):
  if provider == 'dashscope_multimodal':
    content_items = (
      payload.get('output', {})
      .get('choices', [{}])[0]
      .get('message', {})
      .get('content', [])
    )

    text_value = ''
    images = []
    for item in content_items:
      if not isinstance(item, dict):
        continue
      if item.get('text') and not text_value:
        text_value = item['text']
      image_url = item.get('image') or item.get('url')
      if image_url:
        images.append({
          'url': image_url,
          'revised_prompt': text_value,
        })

    if not images:
      raise ValueError(extract_error_message(payload) or 'No image URL returned by DashScope.')

    return {
      'data': images,
    }

  if isinstance(payload, dict) and isinstance(payload.get('data'), list):
    return payload

  raise ValueError('Unsupported image response format.')


def proxy_image_generation(target_url, api_key, model, prompt, size):
  provider = detect_provider(target_url, model)
  payload = build_upstream_payload(provider, model, prompt, size)
  headers = {
    'Content-Type': 'application/json',
  }
  if api_key:
    headers['Authorization'] = f'Bearer {api_key}'

  upstream_request = request.Request(
    target_url,
    method='POST',
    headers=headers,
    data=json.dumps(payload).encode('utf-8'),
  )

  try:
    with request.urlopen(upstream_request, timeout=180, context=create_ssl_context()) as response:
      upstream_body = response.read()
      parsed = json.loads(upstream_body.decode('utf-8'))
      return normalize_upstream_response(provider, parsed)
  except error.HTTPError as exc:
    raw = exc.read().decode('utf-8', errors='replace')
    try:
      parsed_error = json.loads(raw)
      message = extract_error_message(parsed_error)
    except json.JSONDecodeError:
      parsed_error = {'raw': raw}
      message = raw or f'HTTP {exc.code}'
    raise RuntimeError(message) from exc
  except error.URLError as exc:
    reason = str(exc.reason)
    if 'CERTIFICATE_VERIFY_FAILED' in reason:
      raise RuntimeError(
        'Local SSL certificate verification failed. For local testing, restart with CHATBUTTE_INSECURE_SSL=1.'
      ) from exc
    raise RuntimeError(reason) from exc


class ChatbutteHandler(SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=ROOT_DIR, **kwargs)

  def log_message(self, format_string, *args):
    super().log_message(format_string, *args)

  def end_headers(self):
    if self.path.endswith(('.html', '.css', '.js')) or self.path in {'/', '/index.html'}:
      self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      self.send_header('Pragma', 'no-cache')
      self.send_header('Expires', '0')
    super().end_headers()

  def do_GET(self):
    if self.path.startswith('/api/image-proxy'):
      self.handle_image_proxy()
      return
    return super().do_GET()

  def do_POST(self):
    if self.path == '/api/image-generate':
      self.handle_image_generate()
      return
    json_response(self, 404, {'message': 'Not found'})

  def do_OPTIONS(self):
    if self.path == '/api/image-generate':
      self.send_response(204)
      self.send_header('Access-Control-Allow-Origin', '*')
      self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      self.end_headers()
      return
    self.send_response(204)
    self.end_headers()

  def handle_image_proxy(self):
    try:
      parsed = parse.urlparse(self.path)
      query = parse.parse_qs(parsed.query)
      target_url = validate_target_url(query.get('url', [''])[0])
      upstream_request = request.Request(
        target_url,
        method='GET',
        headers={'User-Agent': 'Chatbutte/1.0'},
      )
      with request.urlopen(upstream_request, timeout=120, context=create_ssl_context()) as response:
        body = response.read()
        content_type = response.headers.get('Content-Type', 'image/png')
      self.send_response(200)
      self.send_header('Content-Type', content_type)
      self.send_header('Content-Disposition', 'inline')
      self.send_header('Cache-Control', 'private, max-age=3600')
      self.end_headers()
      self.wfile.write(body)
    except ValueError as exc:
      json_response(self, 400, {'message': str(exc)})
    except error.HTTPError as exc:
      raw = exc.read().decode('utf-8', errors='replace')
      json_response(self, exc.code, {'message': raw or f'HTTP {exc.code}'})
    except error.URLError as exc:
      reason = str(exc.reason)
      if 'CERTIFICATE_VERIFY_FAILED' in reason:
        json_response(self, 502, {
          'message': 'Local SSL certificate verification failed. For local testing, restart with CHATBUTTE_INSECURE_SSL=1.'
        })
        return
      json_response(self, 502, {'message': reason})
    except Exception as exc:
      json_response(self, 500, {'message': f'Unexpected server error: {exc}'})

  def handle_image_generate(self):
    content_length = int(self.headers.get('Content-Length', '0'))
    raw_body = self.rfile.read(content_length)
    try:
      payload = json.loads(raw_body.decode('utf-8'))
      target_url = validate_target_url(payload.get('target_url', ''))
      api_key = payload.get('api_key', '')
      model = (payload.get('model') or '').strip()
      prompt = (payload.get('prompt') or '').strip()
      size = (payload.get('size') or '1024x1024').strip()
      if not model:
        raise ValueError('Model is required.')
      if not prompt:
        raise ValueError('Prompt is required.')
      result = proxy_image_generation(target_url, api_key, model, prompt, size)
      json_response(self, 200, result)
    except ValueError as exc:
      json_response(self, 400, {'message': str(exc)})
    except RuntimeError as exc:
      json_response(self, 502, {'message': str(exc)})
    except json.JSONDecodeError:
      json_response(self, 400, {'message': 'Invalid JSON body.'})
    except Exception as exc:
      json_response(self, 500, {'message': f'Unexpected server error: {exc}'})


def main():
  parser = argparse.ArgumentParser(description='Chatbutte static server with image proxy support.')
  parser.add_argument('--host', default='0.0.0.0')
  parser.add_argument('--port', type=int, default=8080)
  args = parser.parse_args()

  server = ThreadingHTTPServer((args.host, args.port), ChatbutteHandler)
  print(f'Serving Chatbutte on http://{args.host}:{args.port}')
  server.serve_forever()


if __name__ == '__main__':
  main()
