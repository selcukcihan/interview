import { Marked } from 'marked';

const marked = new Marked({
  gfm: true,
  breaks: false
});

function rewriteGeneratedMarkdownLinks(markdown: string, sourcePath: string): string {
  const sourceDir = sourcePath.split('/').slice(0, -1).join('/');

  return markdown.replace(/\]\(([^)\s]+\.generated\.md)(#[^)]+)?\)/g, (match, href: string, hash = '') => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) {
      return match;
    }

    let targetPath = `${sourceDir}/${href}`
      .split('/')
      .reduce<string[]>((segments, segment) => {
        if (!segment || segment === '.') return segments;
        if (segment === '..') segments.pop();
        else segments.push(segment);
        return segments;
      }, [])
      .join('/')
      .replace(/\.generated\.md$/, '');

    if (targetPath.endsWith('/suggested_questions')) {
      targetPath = targetPath.replace(/\/suggested_questions$/, '');
    }

    return `](/${targetPath}/${hash})`;
  });
}

export function renderMarkdown(markdown: string, sourcePath: string): string {
  const publishableMarkdown = rewriteGeneratedMarkdownLinks(markdown, sourcePath);
  return marked.parse(publishableMarkdown, { async: false }) as string;
}
