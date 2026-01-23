import {preprocessMarkdown} from './dist/preprocessor.js';

const markdown = `# Test

\`\`\`bash
mkdir -p demo-project
# set the current directory
cd demo-project
\`\`\`

\`\`\`bash
pwd
\`\`\`
`;

console.log('INPUT:');
console.log(markdown);
console.log('\nOUTPUT:');
const {preprocessedMarkdown} = preprocessMarkdown(markdown);
console.log(preprocessedMarkdown);
