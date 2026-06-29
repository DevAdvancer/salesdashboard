let notificationSound: HTMLAudioElement | null = null;

// Initialize sound lazily to avoid SSR issues
function getSound(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!notificationSound) {
    notificationSound = new Audio('/notification.mp3');
    notificationSound.preload = 'auto';
    notificationSound.volume = 0.5;
  }
  return notificationSound;
}

export function playNotificationSound() {
  const sound = getSound();
  if (sound) {
    sound.currentTime = 0;
    void sound.play().catch(() => {
      // Sound file might not exist yet, fail silently
    });
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  if (Notification.permission !== 'denied') {
    return await Notification.requestPermission();
  }
  return Notification.permission;
}

export function showBrowserNotification(title: string, options?: NotificationOptions) {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, options);
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, options);
      }
    });
  }
}

// Request permission on module load (client-side only)
if (typeof window !== 'undefined') {
  requestNotificationPermission();
}