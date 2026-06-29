import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = path.dirname(fileURLToPath(import.meta.url)).replace(`${path.sep}scripts`, '');
const sourceDir = path.resolve(websiteDir, '..');
const targetDir = path.join(websiteDir, 'content', 'question_sessions');

const excludedFileNames = new Set(['index.generated.md', 'prompts.generated.md']);
const copied = [];

function humanize(value) {
  const words = value
    .replace(/\.generated$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return words
    .replace(/\bApi\b/g, 'API')
    .replace(/\bHttp\b/g, 'HTTP')
    .replace(/\bNat\b/g, 'NAT')
    .replace(/\bSql\b/g, 'SQL')
    .replace(/\bPostgresql\b/g, 'PostgreSQL')
    .replace(/\bWebsockets\b/g, 'WebSockets');
}

function keepOnlyAnsweredQuestions(markdown, relativePath) {
  if (!relativePath.endsWith('suggested_questions.generated.md')) {
    return markdown;
  }

  const answered = markdown.match(/\n## Answered Questions\n[\s\S]*?(?=\n## |$)/);
  const folderName = path.basename(path.dirname(relativePath));
  const title = humanize(folderName);

  if (!answered) {
    return '';
  }

  return `# ${title}\n${answered[0].trimEnd()}\n`;
}

function removeSuggestedBacklinks(markdown) {
  return markdown.replace(
    /^Suggested questions: \[Suggested questions\]\(\.\/suggested_questions\.generated\.md\)\n?/m,
    ''
  );
}

function stripPrivateSections(markdown) {
  const lines = markdown.split('\n');
  const publishedLines = [];
  let strippedHeadingLevel = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);

    if (heading && heading[2].toLowerCase() === 'chat log') {
      strippedHeadingLevel = heading[1].length;
      continue;
    }

    if (strippedHeadingLevel !== null) {
      const nextHeadingLevel = heading?.[1].length;

      if (!nextHeadingLevel || nextHeadingLevel > strippedHeadingLevel) {
        continue;
      }

      strippedHeadingLevel = null;
    }

    publishedLines.push(line);
  }

  return publishedLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd().concat('\n');
}

async function walk(currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(sourceDir, sourcePath);

    if (relativePath === 'website' || relativePath.startsWith(`website${path.sep}`)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walk(sourcePath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.generated.md')) {
      continue;
    }

    if (excludedFileNames.has(entry.name)) {
      continue;
    }

    const targetPath = path.join(targetDir, relativePath);
    const markdown = await readFile(sourcePath, 'utf8');
    const publishedMarkdown = removeSuggestedBacklinks(keepOnlyAnsweredQuestions(stripPrivateSections(markdown), relativePath));
    if (!publishedMarkdown.trim()) {
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, publishedMarkdown, 'utf8');
    copied.push(relativePath);
  }
}

async function main() {
  const sourceStats = await stat(sourceDir);

  if (!sourceStats.isDirectory()) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await walk(sourceDir);

  copied.sort();
  console.log(`Synced ${copied.length} Markdown files to ${path.relative(websiteDir, targetDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
