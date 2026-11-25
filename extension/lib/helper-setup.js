// How to install the copy helper for this copy of ClipSnatcher. Shown in Settings.
//
// The copy loaded unpacked from the project has the development ID (fixed by the "key" in
// manifest.json), and its helper is installed from the project folder. Every other copy
// (the Chrome Web Store one) downloads the helper from the project's latest GitHub
// release and passes its own ID, since the helper only answers the IDs it was installed for.

export const DEV_ID = 'phdbcmaifcaagmfkmbdhokgmkldllajj';
export const REPO = 'https://github.com/AES256Afro/ClipSnatcher';

// The release asset names; scripts/build-helper-zips.sh makes these files.
export const helperZipName = (os) => `clipsnatcher-helper-${os === 'win' ? 'windows' : 'macos'}.zip`;

/**
 * @param {string} os           chrome.runtime.getPlatformInfo().os: 'mac' or 'win'
 * @param {string} extensionId  chrome.runtime.id
 * @returns {{ fromProject: boolean, download: string, folder: string, command: string }}
 *   download: the zip to get first ('' when installing from the project folder);
 *   folder: where unzipping it puts the files, as the command expects them
 */
export function helperSetup(os, extensionId) {
  const win = os === 'win';
  const fromProject = extensionId === DEV_ID;
  // Chrome extension IDs are 32 letters a-p; anything else is left out of the command.
  const ids = !fromProject && /^[a-p]{32}$/.test(extensionId || '') ? ' ' + extensionId : '';
  if (fromProject) {
    return {
      fromProject, download: '', folder: '',
      command: win
        ? 'powershell -ExecutionPolicy Bypass -File "$HOME\\Projects\\ClipSnatcher\\native-helper\\windows\\install.ps1"'
        : 'bash ~/Projects/ClipSnatcher/native-helper/install.sh',
    };
  }
  // Unzipping in Finder, or "Extract All" in File Explorer with its suggested folder, puts
  // the files in a folder named after the zip, next to it in Downloads.
  const folder = win ? 'Downloads\\clipsnatcher-helper-windows' : 'Downloads/clipsnatcher-helper-macos';
  return {
    fromProject,
    download: `${REPO}/releases/latest/download/${helperZipName(os)}`,
    folder,
    command: win
      ? `powershell -ExecutionPolicy Bypass -File "$HOME\\${folder}\\install.ps1"${ids}`
      : `bash ~/${folder}/install.sh${ids}`,
  };
}
