// config.js - 统一入口，转发到 config/index.js
export { appConfig, default as appConfigDefault } from './config/index.js';
export const studioConfig = {
  theme: "dark",
  fonts: ["Inter", "Geist Mono", "Helvetica"],
  testColors: ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF"],
  animationSpeed: 0.8,
  screensaverInterval: 5000,
};
