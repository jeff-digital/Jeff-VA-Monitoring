// Convert the existing MIT-licensed Radix icon paths to Android vector resources.
const fs = require('node:fs');
const path = require('node:path');
const packages = path.join(__dirname, 'design-preview/node_modules');
const React = require(path.join(packages, 'react'));
const {renderToStaticMarkup} = require(path.join(packages, 'react-dom/server'));
const icons = require(path.join(packages, '@radix-ui/react-icons'));
const names = {home:'DashboardIcon',tasks:'CheckboxIcon',apply:'FileTextIcon',clients:'PersonIcon',inbox:'EnvelopeClosedIcon',more:'DotsHorizontalIcon',news:'ReaderIcon',wallet:'CardStackIcon',subscriptions:'UpdateIcon',documents:'FileIcon',invoices:'ReaderIcon',assistant:'MagicWandIcon',report:'BarChartIcon',account:'IdCardIcon',settings:'GearIcon',scripts:'TextAlignLeftIcon',links:'Link2Icon',templates:'CopyIcon',salary:'TableIcon',cover_letter:'Pencil2Icon',to_apply:'CalendarIcon',chevron_right:'ChevronRightIcon',clock:'ClockIcon',check:'CheckIcon',sort:'MixerHorizontalIcon',calendar:'CalendarIcon',search:'MagnifyingGlassIcon',edit:'Pencil1Icon',sign_out:'ExitIcon',download:'DownloadIcon',reply:'PaperPlaneIcon',forward:'ArrowRightIcon',star:'StarIcon',archive:'ArchiveIcon',copy:'CopyIcon',delete:'TrashIcon',close:'Cross2Icon',filter:'MixerHorizontalIcon',chevron_down:'ChevronDownIcon'};
const target = path.join(__dirname, 'project/app/src/main/res/drawable');
for (const [name, component] of Object.entries(names)) {
  if (!icons[component]) throw new Error(`Missing library icon ${component}`);
  const svg = renderToStaticMarkup(React.createElement(icons[component]));
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)].map(match => `<path android:fillColor="#FFFFFF" android:fillType="evenOdd" android:pathData="${match[1]}" />`);
  if (!paths.length) throw new Error(`No paths for ${component}`);
  fs.writeFileSync(path.join(target, `ic_ui_${name}.xml`), `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="15" android:viewportHeight="15">\n${paths.join('\n')}\n</vector>\n`);
}
fs.copyFileSync(path.join(packages, '@radix-ui/react-icons/LICENSE'), path.join(__dirname, 'RADIX-ICONS-LICENSE.txt'));
console.log(`Generated ${Object.keys(names).length} consistent native icons.`);
