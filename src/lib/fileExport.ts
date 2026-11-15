import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface ExportFileOptions {
  filename: string;
  content: string;
  mimeType?: string;
  title?: string;
  dialogTitle?: string;
}

export interface ExportResult {
  success: boolean;
  method: 'capacitor-share' | 'web-share' | 'browser-download' | 'share-cancelled';
  error?: string;
}

/**
 * Universal cross-platform file exporter for mobile (Capacitor Android/iOS, Mobile Web)
 * and desktop browsers.
 *
 * 1. On Native Mobile (Capacitor Android/iOS):
 *    - Writes the file directly to device storage using Capacitor Filesystem.
 *    - Opens the native Android/iOS share sheet (allowing direct Save to Device,
 *      Files by Google, Google Drive, WhatsApp, etc.).
 *
 * 2. On Mobile Web (Chrome / Safari):
 *    - Uses navigator.share() with a File object to trigger the native device share modal.
 *
 * 3. On Desktop Web / Browser Fallback:
 *    - Triggers HTML5 <a> download with a Blob URL.
 */
export async function exportFile({
  filename,
  content,
  mimeType = 'text/csv;charset=utf-8;',
  title = 'Oxynity Report',
  dialogTitle = 'Save or Share Report',
}: ExportFileOptions): Promise<ExportResult> {
  // 1. Native Capacitor Environment (Android / iOS)
  if (Capacitor.isNativePlatform()) {
    try {
      // Write file into Cache directory (configured in Android FileProvider)
      const writeResult = await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });

      // Also attempt to save a persistent copy in Documents directory
      try {
        await Filesystem.writeFile({
          path: filename,
          data: content,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
      } catch {
        // Scoped storage on newer Android versions may restrict direct Documents write; cache write succeeded
      }

      // Trigger native Android / iOS system share sheet
      try {
        await Share.share({
          title,
          text: `Oxynity Aquaculture Report: ${filename}`,
          url: writeResult.uri,
          files: [writeResult.uri],
          dialogTitle,
        });
        return { success: true, method: 'capacitor-share' };
      } catch (shareErr: any) {
        // If user cancelled or dismissed the share sheet, the file is already saved
        const isDismissed =
          shareErr?.message?.includes('canceled') ||
          shareErr?.message?.includes('dismiss') ||
          shareErr?.name === 'AbortError';

        if (isDismissed) {
          return { success: true, method: 'share-cancelled' };
        }
        console.warn('Capacitor Share failed, falling back to Web Share / Download:', shareErr);
      }
    } catch (fsErr) {
      console.warn('Capacitor Filesystem write error, falling back to Web Share / Download:', fsErr);
    }
  }

  // 2. Web Share API with File (Mobile Chrome, Safari, Edge)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const blob = new Blob([content], { type: mimeType });
      const file = new File([blob], filename, { type: mimeType });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title,
          text: `Oxynity Aquaculture Report: ${filename}`,
          files: [file],
        });
        return { success: true, method: 'web-share' };
      }
    } catch (shareErr: any) {
      if (shareErr?.name === 'AbortError') {
        // User dismissed share dialog
        return { success: true, method: 'share-cancelled' };
      }
      console.warn('Web Share API error, falling back to browser download:', shareErr);
    }
  }

  // 3. Desktop / Browser Download Fallback
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      try {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 2000);

    return { success: true, method: 'browser-download' };
  } catch (err: any) {
    console.error('File export failed on all methods:', err);
    return {
      success: false,
      method: 'browser-download',
      error: err?.message || 'Download failed',
    };
  }
}
