import { Buffer } from 'node:buffer';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import interLatinExt from '@fontsource/inter/files/inter-latin-ext-700-normal.woff?inline';
import inter from '@fontsource/inter/files/inter-latin-700-normal.woff?inline';
import satori, { init, type Font } from 'satori/wasm';
import initYoga from 'yoga-wasm-web';
import yogaWasm from 'yoga-wasm-web/dist/yoga.wasm';
import portrait from '../assets/images/site/dd-pixel-portrait-edited.png?inline';
import tag from '../assets/svg/dd-mark.svg?raw';
import { socialImageSize } from './social-images';

// Workers require precompiled WebAssembly modules. The Cloudflare adapter
// bundles these imports as modules for both the build and the runtime.
await Promise.all([initWasm(resvgWasm), initYoga(yogaWasm).then(init)]);

const fonts: Font[] = [
  { name: 'Inter', data: Buffer.from(inter.split(',')[1], 'base64'), weight: 700 },
  { name: 'Inter Extended', data: Buffer.from(interLatinExt.split(',')[1], 'base64'), weight: 700 },
];
const whiteTag = tag.replace('<path ', '<path fill="#ffffff" ');
const tagImage = `data:image/svg+xml;base64,${Buffer.from(whiteTag).toString('base64')}`;

function SocialCard({ title }: { title?: string }) {
  const { width, height } = socialImageSize;
  const heading = title?.replace(/\s+/g, ' ').trim();
  const fontSize = heading ? Math.max(40, Math.min(88, 120 - heading.length * 0.6)) : 110;
  const lineHeight = heading ? 1.05 : 0.94;
  const lineClamp = Math.floor(390 / (fontSize * lineHeight));

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', width, height,
      padding: '48px 64px 42px', background: '#fff8f3', color: '#27191a', fontFamily: 'Inter', fontWeight: 700,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 84, height: 84, background: '#fc571a',
      }}>
        <img src={tagImage} width={64} height={64} alt="" />
      </div>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 704, fontSize, lineHeight, lineClamp, letterSpacing: '-0.045em',
          whiteSpace: heading ? 'normal' : 'pre', wordBreak: 'break-word',
        }}>
          {heading || 'David\nDemaree'}
        </div>
        <div style={{ display: 'flex', border: '2px solid #27191a', boxShadow: '10px 10px #f6d6c8' }}>
          <img src={portrait} width={318} height={318} alt="" />
        </div>
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid #bc9d92', paddingTop: 22, fontSize: 24 }}>
        demaree.me
      </div>
    </div>
  );
}

export async function renderSocialImage(title?: string) {
  const svg = await satori(<SocialCard title={title} />, { ...socialImageSize, fonts });
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    const image = renderer.render();
    try {
      return new Uint8Array(image.asPng());
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
