/* Entry point for both builds. Importing popup.js pulls in the platform layer,
 * which decides — from whether a real extension runtime is present — whether
 * this is the extension popup or the hosted web app. Then it starts. */
import { init } from './popup.js';
init();
