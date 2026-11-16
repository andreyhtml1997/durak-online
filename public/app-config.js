// По умолчанию игра идёт через интернет-сервер onlineServer (папка server/, хостинг Render).
// Wi-Fi режим остался: кнопка «Запустить Wi-Fi сервер на этом телефоне» или свой адрес в поле.
// Веб-версия, открытая с самого сервера, всегда использует свой адрес (location.origin).
// ПОСЛЕ ДЕПЛОЯ: впишите сюда адрес сервера и пересоберите APK (python tools/build_apk.py).
window.DURAK_CONFIG = {
  transport: 'lan',
  onlineServer: 'https://durak-online-mprl.onrender.com',
  publicBaseUrl: ''
};
