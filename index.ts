// Точка входа на телефоне. В вебе — index.web.ts: там CanvasKit грузится раньше Skia.
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
