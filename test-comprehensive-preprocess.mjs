import {fs} from 'zx';
import {preprocessMarkdown} from './dist/preprocessor.js';

const markdown = await fs.readFile('./test-comprehensive.md', 'utf8');
const {preprocessedMarkdown} = preprocessMarkdown(markdown);

console.log('PREPROCESSED:');
console.log('='.repeat(60));
console.log(preprocessedMarkdown);
console.log('='.repeat(60));
