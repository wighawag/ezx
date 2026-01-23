import {preprocessMarkdown} from './dist/preprocessor.js';

const markdown = `# Test

\`\`\`bash
mkdir -p dir1
# set the current directory
cd dir1
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
