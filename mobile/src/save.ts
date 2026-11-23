import { Directory, File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { Alert, Linking, Platform } from "react-native";
import { L } from "./i18n";

/** Скачать видео в галерею телефона. */
export async function saveToGallery(url: string): Promise<void> {
  if (Platform.OS === "web") {
    Linking.openURL(url); // в браузере просто открываем видео: его можно сохранить оттуда
    return;
  }
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    Alert.alert(L("Нет доступа к галерее", "No access to gallery"),
                L("Разреши HypeCut сохранять видео в настройках телефона.", "Allow HypeCut to save videos in your phone settings."));
    return;
  }
  const dir = new Directory(Paths.cache, "clips");
  if (!dir.exists) dir.create();
  const file: File = await File.downloadFileAsync(url, dir, { idempotent: true });
  await MediaLibrary.Asset.create(file.uri);
  Alert.alert(L("Сохранено", "Saved"), L("Клип в галерее телефона.", "The clip is in your gallery."));
}
