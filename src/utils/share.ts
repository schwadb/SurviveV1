import { Platform } from 'react-native';
import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Hand a text file to the user: browser download on web, a real file
 * through the system share sheet on Android/iOS (so it can be opened in
 * Sheets/Numbers, attached to email, or saved to Drive/iCloud).
 */
export async function exportTextFile(name: string, mimeType: string, content: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new FsFile(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}
