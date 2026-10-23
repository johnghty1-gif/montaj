// electron-builder's own exe editing (signAndEditExecutable) needs symlink rights to unpack its tools on
// Windows, so it is turned off; this hook sets the app icon and version info on Montaj.exe with rcedit instead.
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const mod = require('rcedit');
  const rcedit = typeof mod === 'function' ? mod : mod.rcedit || mod.default;
  const { productFilename, version } = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${productFilename}.exe`);
  await rcedit(exe, {
    icon: path.join(context.packager.info.projectDir, 'build', 'icon.ico'),
    'file-version': version,
    'product-version': version,
    'version-string': {
      ProductName: 'Montaj - مونتاج',
      FileDescription: 'Montaj - محرر فيديو عربي',
      CompanyName: 'Montaj',
      LegalCopyright: 'Montaj',
      OriginalFilename: `${productFilename}.exe`,
    },
  });
};
