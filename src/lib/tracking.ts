import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function recordInstall() {
  const hasRecorded = localStorage.getItem('app_installed_recorded');
  if (hasRecorded) return;

  try {
    const userAgent = window.navigator.userAgent;
    let platform = 'Unknown';
    if (/android/i.test(userAgent)) platform = 'Android';
    else if (/iphone|ipad|ipod/i.test(userAgent)) platform = 'iOS';
    else if (/windows/i.test(userAgent)) platform = 'Windows';
    else if (/mac/i.test(userAgent)) platform = 'Mac';
    else if (/linux/i.test(userAgent)) platform = 'Linux';

    await addDoc(collection(db, 'installs'), {
      deviceInfo: userAgent,
      platform,
      installedAt: serverTimestamp()
    });
    localStorage.setItem('app_installed_recorded', 'true');
  } catch (error) {
    console.error('Failed to record install:', error);
  }
}
