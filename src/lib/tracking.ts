import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

function getIPhoneModel() {
  const w = Math.min(window.screen.width, window.screen.height);
  const h = Math.max(window.screen.width, window.screen.height);
  const ratio = window.devicePixelRatio;

  if (w === 430 && h === 932) return 'iPhone 14/15/16 Pro Max';
  if (w === 393 && h === 852) return 'iPhone 14/15/16 Pro (or 16)';
  if (w === 428 && h === 926) return 'iPhone 12/13/14 Pro Max';
  if (w === 390 && h === 844) return 'iPhone 12/13/14 (Pro)';
  if (w === 414 && h === 896) return ratio === 2 ? 'iPhone 11/XR' : 'iPhone 11 Pro Max/XS Max';
  if (w === 375 && h === 812) return 'iPhone X/XS/11 Pro/12 Mini/13 Mini';
  if (w === 414 && h === 736) return 'iPhone 6/7/8 Plus';
  if (w === 375 && h === 667) return 'iPhone 6/7/8/SE';
  return 'iPhone';
}

function extractAndroidModel(ua: string) {
  const match = ua.match(/Android [^;]+; ([^)]+)\)/);
  if (match && match[1]) {
    return match[1].split('Build/')[0].trim();
  }
  return 'Android Device';
}

export async function recordInstall() {
  const hasRecorded = localStorage.getItem('app_installed_recorded');
  if (hasRecorded) return;

  try {
    const userAgent = window.navigator.userAgent;
    let platform = 'Unknown';
    let deviceName = 'Unknown Device';

    if (/android/i.test(userAgent)) {
      platform = 'Android';
      deviceName = extractAndroidModel(userAgent);
    } else if (/iphone/i.test(userAgent)) {
      platform = 'iOS';
      deviceName = getIPhoneModel();
    } else if (/ipad/i.test(userAgent)) {
      platform = 'iOS';
      deviceName = 'iPad';
    } else if (/windows/i.test(userAgent)) {
      platform = 'Windows';
      deviceName = 'Windows PC';
    } else if (/mac/i.test(userAgent)) {
      platform = 'Mac';
      deviceName = 'MacBook/Mac';
    } else if (/linux/i.test(userAgent)) {
      platform = 'Linux';
      deviceName = 'Linux PC';
    }

    if ((navigator as any).userAgentData) {
      try {
        const highEntropyValues = await (navigator as any).userAgentData.getHighEntropyValues(['model']);
        if (highEntropyValues.model) {
          deviceName = highEntropyValues.model;
        }
      } catch (e) {}
    }

    await addDoc(collection(db, 'installs'), {
      deviceInfo: userAgent,
      platform,
      deviceName,
      installedAt: serverTimestamp()
    });
    localStorage.setItem('app_installed_recorded', 'true');
  } catch (error) {
    console.error('Failed to record install:', error);
  }
}
