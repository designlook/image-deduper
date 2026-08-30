export default {
  outDir: 'dist-artifacts',
  packagerConfig: {
    asar: true,
    name: 'ImageDeduper',
    executableName: 'ImageDeduper',
    ignore: [/^\/(?:out|dist-artifacts)(?:-|\/|$)/, /^\/\.git(?:hub)?(?:\/|$)/]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'image_deduper',
        setupExe: 'ImageDeduper-Setup.exe',
        noMsi: true
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {}
    }
  ]
}
