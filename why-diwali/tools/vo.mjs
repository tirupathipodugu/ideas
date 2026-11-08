// Makes the narration: one mp3 per card, voice en-IN-NeerjaNeural (edge-tts). Run: node tools/vo.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INTRO, CH, END, plain } from '../js/story.js';

const out = fileURLToPath(new URL('../vo/', import.meta.url));
mkdirSync(out, { recursive: true });
const jobs = [['intro', INTRO.paras], ['end', END.paras]];
CH.forEach((c) => { jobs.push([`${c.key}-story`, c.story], [`${c.key}-fact`, c.fact]); });
for (const [name, paras] of jobs) {
  const txt = `${out}${name}.txt`;
  writeFileSync(txt, paras.map(plain).join('\n\n'));
  execFileSync('python', ['-m', 'edge_tts', '--voice', 'en-IN-NeerjaNeural', '--rate=-4%', '-f', txt, '--write-media', `${out}${name}.mp3`]);
  console.log(name);
}
