export type QuestionNote = {
  slug: string;
  title: string;
  category: string;
  subtopic: string;
  isSuggestedQuestions: boolean;
  segments: string[];
  sourcePath: string;
  body: string;
};

export type Subtopic = {
  key: string;
  category: string;
  title: string;
  pathLabel: string;
  suggested: QuestionNote;
  answers: QuestionNote[];
};

export type FolderIndex = {
  slug: string;
  title: string;
  pathLabel: string;
  segments: string[];
  childFolders: Array<{
    slug: string;
    title: string;
    answerCount: number;
    pageCount: number;
  }>;
  pages: QuestionNote[];
};

const markdownFiles = import.meta.glob('../../content/question_sessions/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

function humanize(value: string): string {
  const words = value
    .replace(/\.generated$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return words
    .replace(/\bApi\b/g, 'API')
    .replace(/\bAuth\b/g, 'Auth')
    .replace(/\bHttp\b/g, 'HTTP')
    .replace(/\bNat\b/g, 'NAT')
    .replace(/\bSql\b/g, 'SQL')
    .replace(/\bPostgresql\b/g, 'PostgreSQL')
    .replace(/\bWebsockets\b/g, 'WebSockets');
}

function titleFromMarkdown(body: string, fallback: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || humanize(fallback);
}

function noteFromEntry([pathName, body]: [string, string]): QuestionNote {
  const relativePath = pathName.replace('../../content/question_sessions/', '');
  const withoutExtension = relativePath.replace(/\.md$/, '');
  const slug = withoutExtension.replace(/\.generated$/, '');
  const segments = slug.split('/');
  const fileName = segments.at(-1) || slug;

  return {
    slug,
    title: titleFromMarkdown(body, fileName),
    category: segments.length > 1 ? humanize(segments[0]) : 'General',
    subtopic: segments.length > 2 ? humanize(segments.at(-2) || 'General') : 'General',
    isSuggestedQuestions: fileName === 'suggested_questions',
    segments,
    sourcePath: relativePath,
    body
  };
}

function hasAnsweredQuestions(body: string): boolean {
  return /^## Answered Questions\n\n- /m.test(body);
}

export function getNotes(): QuestionNote[] {
  return Object.entries(markdownFiles)
    .map(noteFromEntry)
    .filter((note) => !note.isSuggestedQuestions || hasAnsweredQuestions(note.body))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getNotesByCategory(): Map<string, QuestionNote[]> {
  const categories = new Map<string, QuestionNote[]>();

  for (const note of getNotes()) {
    const notes = categories.get(note.category) || [];
    notes.push(note);
    categories.set(note.category, notes);
  }

  return new Map([...categories.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function getSubtopics(): Subtopic[] {
  const notes = getNotes();
  const suggestedNotes = notes.filter((note) => note.isSuggestedQuestions);

  return suggestedNotes
    .map((suggested) => {
      const subtopicPath = suggested.segments.slice(0, -1).join('/');
      const answers = notes
        .filter((note) => !note.isSuggestedQuestions && note.segments.slice(0, -1).join('/') === subtopicPath)
        .sort((a, b) => a.title.localeCompare(b.title));

      return {
        key: subtopicPath,
        category: suggested.category,
        title: suggested.subtopic,
        pathLabel: subtopicPath,
        suggested,
        answers
      };
    })
    .filter((subtopic) => subtopic.answers.length > 0)
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

export function getSubtopicsByCategory(): Map<string, Subtopic[]> {
  const categories = new Map<string, Subtopic[]>();

  for (const subtopic of getSubtopics()) {
    const subtopics = categories.get(subtopic.category) || [];
    subtopics.push(subtopic);
    categories.set(subtopic.category, subtopics);
  }

  return new Map([...categories.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function getFolderIndexes(): FolderIndex[] {
  const notes = getNotes();
  const folders = new Set<string>();

  for (const note of notes) {
    const pageFolders = note.segments.slice(0, -1);

    for (let index = 1; index <= pageFolders.length; index += 1) {
      folders.add(pageFolders.slice(0, index).join('/'));
    }
  }

  return [...folders]
    .sort()
    .map((folder) => {
      const segments = folder.split('/');
      const directPages = notes
        .filter((note) => !note.isSuggestedQuestions && note.segments.slice(0, -1).join('/') === folder)
        .sort((a, b) => a.title.localeCompare(b.title));
      const childFolderSlugs = [...folders]
        .filter((candidate) => {
          if (!candidate.startsWith(`${folder}/`)) return false;
          return candidate.slice(folder.length + 1).split('/').length === 1;
        })
        .sort();

      return {
        slug: folder,
        title: humanize(segments.at(-1) || folder),
        pathLabel: folder,
        segments,
        childFolders: childFolderSlugs
          .map((childSlug) => ({
            slug: childSlug,
            title: humanize(childSlug.split('/').at(-1) || childSlug),
            answerCount: notes.filter((note) => !note.isSuggestedQuestions && note.slug.startsWith(`${childSlug}/`)).length,
            pageCount: notes.filter((note) => note.slug.startsWith(`${childSlug}/`)).length
          }))
          .filter((child) => child.answerCount > 0),
        pages: directPages
      };
    });
}
