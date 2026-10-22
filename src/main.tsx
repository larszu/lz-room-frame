import '@fontsource-variable/public-sans';
import './tokens.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(<App />);
