// Metro — как у Expo по умолчанию; плюс файлы `.bin` — ресурсы, как картинки и звуки: каскад детектора лиц
// «Найти лица» (assets/faces/facefinder.bin, с 0.24.0) едет в APK и в веб-сборку отдельным файлом и
// читается только по кнопке, а не лежит в коде строкой.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('bin');

module.exports = config;
