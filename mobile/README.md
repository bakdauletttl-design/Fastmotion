# HypeCut для iPhone и Android

Одно приложение на React Native (Expo) для обеих платформ.

Экраны:
1. **Вход**: Sign in with Apple (на iPhone) и Google.
2. **Подключи Telegram**: открывает общего бота HypeCut с одноразовым кодом, после «Start» всё связывается само.
3. **Клипы**: лента готовых клипов, просмотр, переключение на вертикальную 9:16 версию, «Поделиться».
4. **Каналы**: добавить любого стримера по нику или ссылке.
5. **Тарифы**: пробный / Standard / Pro, оплата через App Store и Google Play (RevenueCat).
6. **Профиль**: тариф, Telegram, выход, удаление аккаунта (этого требует Apple).

Все цвета лежат в `src/ui.tsx` (объект `c`), так что сменить фирменный цвет можно в одном месте.

## Запуск для разработки

```bash
cd mobile
npm install
cp .env.example .env     # адрес сервера и ключи
npx eas-cli@latest build --profile development --platform ios   # или android
npx expo start
```
Вход через Apple/Google и покупки работают только в собственной сборке (development build), не в Expo Go.

## Что нужно сделать владельцу

- Apple Developer ($99 в год) и Google Play Console ($25 один раз).
- Google Cloud Console: OAuth Client ID для iOS, Android и Web, вставить в `.env` приложения и в `GOOGLE_CLIENT_IDS` на сервере.
  В `app.json` заменить `REPLACE_WITH_IOS_CLIENT_ID` на iOS Client ID (перевёрнутый, как подсказывает Google).
- RevenueCat: подключить App Store и Google Play, создать подписки `hypecut_standard_monthly` и `hypecut_pro_monthly`.
- Публикация: `npx eas-cli@latest build --profile production` и `npx eas-cli@latest submit`.
