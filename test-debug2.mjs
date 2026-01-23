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

const result = preprocessMarkdown(markdown);

console.log('PREPROCESSED:');
console.log(result.preprocessedMarkdown);
console.log('\nEXTRACTED FILES:');
result.extractedFiles.forEach((f) => console.log(f.filePath));
