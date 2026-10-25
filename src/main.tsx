import ReactDOM from 'react-dom/client';
import App from './App';
import { initialize } from './store';
import './styles.css';
import 'highlight.js/styles/github-dark.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
void initialize();
