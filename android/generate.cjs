// Regenerate launcher artwork only. Native screens are maintained in project/.
const fs = require('node:fs');
const path = require('node:path');
const Jimp = require('jimp');
(async () => {
  const source = await Jimp.read(path.join(__dirname, '../src/frontend/images/tab.png'));
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const directory = path.join(__dirname, 'project/app/src/main/res/mipmap-' + density);
    fs.mkdirSync(directory, { recursive: true });
    await source.clone().resize(size, size).writeAsync(path.join(directory, 'ic_launcher.png'));
  }
  await source.clone().resize(512, 512).writeAsync(path.join(__dirname, 'project/store_icon.png'));
  console.log('Native launcher icons generated from the Jeff VA logo.');
})().catch(error => { console.error(error); process.exitCode = 1; });
