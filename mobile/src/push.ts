import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";
import { L } from "./i18n";

// Показываем уведомление, даже когда приложение открыто
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Спрашивает разрешение и отправляет токен телефона на сервер. Тихо ничего не делает, если нельзя. */
export async function registerPush(): Promise<void> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("clips", {
        name: L("Клипы и эфиры", "Clips and live alerts"),
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: "#2EE59D",
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return; // появится после первой сборки через EAS
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.pushToken(data);
  } catch {
    // эмулятор или нет сети: уведомления просто не придут, приложение работает
  }
}

/** Вызывает onOpen, когда человек нажал на уведомление о клипе. */
export function onNotificationTap(onOpen: (data: Record<string, unknown>) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) =>
    onOpen((r.notification.request.content.data ?? {}) as Record<string, unknown>),
  );
  return () => sub.remove();
}
