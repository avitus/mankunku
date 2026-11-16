import { test } from './fixtures/test';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// Research artifact producer. Runs only through the Linux diagnostic runner.
test('capture production metronome reference for acoustic bleed research', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setContent('<!doctype html><title>Offline acoustic reference</title>');
  await page.addScriptTag({ content: await readFile('node_modules/tone/build/Tone.js', 'utf8') });
  const source = (await readFile('src/lib/audio/metronome.ts', 'utf8'))
    .replace("import { getMasterGain } from './audio-context';", 'const getMasterGain = () => window.__researchMaster;')
    .replace("await import('tone')", 'window.Tone')
    .replaceAll('export ', '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  await page.addScriptTag({ content: `${js}\nwindow.__renderResearch = async () => {
    const buffer = await Tone.Offline(async context => {
      window.__researchMaster = context.rawContext.createGain();
      window.__researchMaster.connect(context.rawContext.destination);
      context.transport.bpm.value = 160;
      await scheduleMetronome(4, 24, 0);
      context.transport.start(0);
    }, 36.5, 1, 48000);
    const bytes = new Uint8Array(buffer.getChannelData(0).buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(text);
  };` });
  const base64 = await page.evaluate(() => (window as any).__renderResearch());
  await writeFile(info.outputPath('metronome-48000.f32'), Buffer.from(base64, 'base64'));
});
