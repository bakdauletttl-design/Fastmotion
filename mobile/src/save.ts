import { Directory, File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { Alert, Linking, Platform } from "react-native";
import { L } from "./i18n";

/** Скачать видео в галерею телефона. */
export async function saveToGallery(url: string, quiet = false): Promise<boolean> {
  if (Platform.OS === "web") {
    if (!quiet) Linking.openURL(url); // в браузере просто открываем видео: его можно сохранить оттуда
    return true;
  }
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    Alert.alert(L("Нет доступа к галерее", "No access to gallery"),
                L("Разреши HypeCut сохранять видео в настройках телефона.", "Allow HypeCut to save videos in your phone settings."));
    return false;
  }
  const dir = new Directory(Paths.cache, "clips");
  if (!dir.exists) dir.create();
  const file: File = await File.downloadFileAsync(url, dir, { idempotent: true });
  await MediaLibrary.Asset.create(file.uri);
  if (!quiet) Alert.alert(L("Сохранено", "Saved"), L("Клип в галерее телефона.", "The clip is in your gallery."));
  return true;
}

/** В TikTok: клип сохраняется в галерею и открывается TikTok, где он уже первым в списке при загрузке. */
export async function shareToTikTok(url: string): Promise<void> {
  if (!(await saveToGallery(url, true))) return;
  const app = "snssdk1233://";
  if (Platform.OS !== "web" && (await Linking.canOpenURL(app).catch(() => false))) {
    Alert.alert(L("Клип в галерее", "Clip is in your gallery", "Клип галереяда"),
                L("Сейчас откроется TikTok: нажми «+» и выбери этот клип.", "TikTok will open: tap “+” and pick this clip.",
                  "TikTok ашылады: «+» басып, осы клипті таңда."),
                [{ text: "OK", onPress: () => Linking.openURL(app) }]);
  } else {
    Linking.openURL("https://www.tiktok.com/upload");
  }
}
