import { useId, useState, type ReactNode } from 'react';

export type SeoGuidePage =
  | 'number'
  | 'percent'
  | 'share'
  | 'resizer'
  | 'editor'
  | 'renamer'
  | 'utm'
  | 'screen'
  | 'whats-new';

type SeoDetail = {
  label: string;
  value: string;
};

type SeoQuestion = {
  question: string;
  answer: string;
};

type SeoInstruction = {
  step: string;
  text: ReactNode;
};

type SeoRelatedLink = {
  href: string;
  label: string;
  description: string;
};

type SeoGuideContent = {
  kicker: string;
  title: string;
  intro: string;
  details: SeoDetail[];
  instructions: SeoInstruction[];
  faqs: SeoQuestion[];
  related?: SeoRelatedLink[];
};

const seoGuides: Record<SeoGuidePage, SeoGuideContent> = {
  number: {
    kicker: 'Bulk number calculator',
    title: 'Fit a pasted number list to a target total',
    intro:
      'Paste a column into Input data, choose Target sum, Working value, or Multiplier, and the tool recalculates each row so Result adds up to the needed total.',
    details: [
      { label: 'Base sum', value: 'Sum of pasted values' },
      { label: 'Target sum', value: 'Scaled result column' },
      { label: 'Rounding', value: '0 to 6 decimals' },
      { label: 'Randomizer', value: 'Controlled value spread' },
    ],
    instructions: [
      {
        step: 'Paste',
        text: (
          <>
            Paste numbers into <strong>Input data</strong> or the <strong>Paste numbers...</strong> field.
          </>
        ),
      },
      {
        step: 'Set',
        text: (
          <>
            Use <strong>Working value</strong>, <strong>Target sum</strong>, or <strong>Multiplier</strong>,
            then adjust <strong>Rounding</strong> and <strong>Randomizer (%)</strong>.
          </>
        ),
      },
      {
        step: 'Copy',
        text: (
          <>
            Check <strong>Result</strong> and press <strong>Copy</strong> when the output column is ready.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is a bulk number calculator?',
        answer:
          'It recalculates a pasted list of values as one column, so each row remains aligned while the total changes.',
      },
      {
        question: 'How is rounding handled?',
        answer:
          'The rounded values are adjusted as a group, so the visible result stays close to the requested total.',
      },
      {
        question: 'When is target sum useful?',
        answer:
          'A target sum is useful when a plan, budget, or report needs the same row proportions but a new final total.',
      },
    ],
    related: [
      {
        href: '/bulk-percent.html',
        label: 'Percent Cruncher',
        description: 'Calculate markup, margin, initial sum, and final sum.',
      },
      {
        href: '/share-splitter.html',
        label: 'Share Splitter',
        description: 'Split one total into named rows and nested groups.',
      },
    ],
  },
  percent: {
    kicker: 'Markup and margin calculator',
    title: 'Calculate markup, margin, initial sum, or final sum',
    intro:
      'Choose what you know in Working value, paste rows into Input data, and Result shows the selected calculation. Data map shows initial sum and markup on one scale from zero to final sum.',
    details: [
      { label: 'Markup amount', value: 'Final sum - Initial sum' },
      { label: 'Markup %', value: 'Markup / Initial sum x 100' },
      { label: 'Margin %', value: 'Markup / Final sum x 100' },
      { label: 'Final sum', value: 'Initial sum + Markup' },
    ],
    instructions: [
      {
        step: 'Choose',
        text: (
          <>
            In <strong>Working value</strong>, choose <strong>Markup</strong>, <strong>Margin</strong>,{' '}
            <strong>Initial sum</strong>, or <strong>Final sum</strong>.
          </>
        ),
      },
      {
        step: 'Paste',
        text: (
          <>
            Set the <strong>Input data</strong> type, then paste rows into <strong>Paste numbers...</strong>.
          </>
        ),
      },
      {
        step: 'Compare',
        text: (
          <>
            Use <strong>Data map</strong>, <strong>Result</strong>, and <strong>Copy</strong> to verify and
            export the calculated column.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is the difference between markup and margin?',
        answer:
          'Markup compares the increase to the original value. Margin compares the increase to the final value, so the same deal can have a 50% markup and a 33.33% margin.',
      },
      {
        question: 'Can multiple values be calculated together?',
        answer:
          'Yes. A pasted column can be calculated row by row while totals, percentages, and result values remain aligned.',
      },
      {
        question: 'How does the data map work?',
        answer:
          'The map uses one horizontal scale from zero to final sum, then splits that line into initial value and markup.',
      },
    ],
    related: [
      {
        href: '/',
        label: 'Number Cruncher',
        description: 'Fit a pasted number list to a target total.',
      },
      {
        href: '/share-splitter.html',
        label: 'Share Splitter',
        description: 'Turn totals into shares, amounts, and grouped rows.',
      },
    ],
  },
  share: {
    kicker: 'Share split calculator',
    title: 'Split Total sum into named rows and groups',
    intro:
      'Enter Total sum, build rows in Input data, and the tool calculates each share plus any remaining backup value.',
    details: [
      { label: 'Total', value: 'Source amount' },
      { label: 'Share', value: 'Percent or value' },
      { label: 'Backup', value: 'Remainder handling' },
      { label: 'Groups', value: 'Nested breakdowns' },
    ],
    instructions: [
      {
        step: 'Set total',
        text: (
          <>
            Enter the main amount in <strong>Total sum</strong>, then set <strong>Rounding</strong> and{' '}
            <strong>Randomizer (%)</strong>.
          </>
        ),
      },
      {
        step: 'Build rows',
        text: (
          <>
            Use <strong>Input data</strong>, <strong>Add row</strong>, and <strong>Add children</strong> to
            create the split structure.
          </>
        ),
      },
      {
        step: 'Export',
        text: (
          <>
            Choose <strong>Pivot style</strong>, <strong>Table leaves only</strong>, or <strong>Values only</strong>,
            then press <strong>Copy result</strong> or <strong>Export CSV</strong>.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is a share split calculator?',
        answer:
          'It converts a total into named parts, using percentages or fixed values while preserving the overall structure.',
      },
      {
        question: 'How are nested groups useful?',
        answer:
          'Nested groups make it easier to compare a parent allocation with the rows that sit underneath it.',
      },
      {
        question: 'What happens to unassigned value?',
        answer:
          'The remaining value can be tracked as a backup or not-set row, keeping the split transparent.',
      },
    ],
    related: [
      {
        href: '/',
        label: 'Number Cruncher',
        description: 'Recalculate pasted rows so the result reaches a target total.',
      },
      {
        href: '/utm-generator.html',
        label: 'UTM Generator',
        description: 'Create campaign URL lists from landing pages and parameters.',
      },
    ],
  },
  resizer: {
    kicker: 'Batch image resizer',
    title: 'Resize images to a chosen ratio, size, and Weight',
    intro:
      'Upload images, choose the crop ratio in Preview, set Zoom and Weight, then press Resize image and download the ready files as a ZIP.',
    details: [
      { label: 'Crop', value: 'Free or preset ratio' },
      { label: 'Output', value: 'Exact dimensions' },
      { label: 'Weight', value: 'Target KB control' },
      { label: 'Export', value: 'Images or ZIP' },
    ],
    instructions: [
      {
        step: 'Load',
        text: (
          <>
            Press <strong>Upload ZIPs or files</strong> and open an image in <strong>Preview</strong>.
          </>
        ),
      },
      {
        step: 'Frame',
        text: (
          <>
            Choose <strong>Free</strong>, <strong>Original</strong>, <strong>1:1</strong>, or{' '}
            <strong>Custom</strong>, then adjust <strong>W</strong>, <strong>H</strong>, <strong>Zoom</strong>,
            and <strong>Weight</strong>.
          </>
        ),
      },
      {
        step: 'Resize',
        text: (
          <>
            Press <strong>Resize image</strong>, then use <strong>Ready images</strong>,{' '}
            <strong>Download ZIP</strong>, <strong>To Asset Renamer</strong>, or{' '}
            <strong>To Creative Editor</strong>.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is a batch image resizer?',
        answer:
          'It processes multiple images with consistent output settings, so each ready file matches the required placement.',
      },
      {
        question: 'Why set a target file weight?',
        answer:
          'A target weight helps match ad network, landing page, or CMS limits while keeping the image visually usable.',
      },
      {
        question: 'Does resizing happen locally?',
        answer:
          'The resize workflow runs in the browser, so the selected files stay on the local device during processing.',
      },
    ],
    related: [
      {
        href: '/creative-editor.html',
        label: 'Creative Editor',
        description: 'Add text, stickers, and backgrounds after resizing.',
      },
      {
        href: '/creative-renamer.html',
        label: 'Asset Renamer',
        description: 'Rename the ready image batch with groups and identifiers.',
      },
    ],
  },
  editor: {
    kicker: 'Creative image editor',
    title: 'Add text or stickers to images and render ready files',
    intro:
      'Upload images, edit Text editor, sticker, background, and padding settings, then press Render to create the files shown in Result.',
    details: [
      { label: 'Canvas', value: 'Size and format' },
      { label: 'Text', value: 'Layer styling' },
      { label: 'Assets', value: 'Images and stickers' },
      { label: 'Export', value: 'Ready creatives' },
    ],
    instructions: [
      {
        step: 'Load',
        text: (
          <>
            Press <strong>Upload ZIPs or files</strong> and select the image in <strong>Preview</strong>.
          </>
        ),
      },
      {
        step: 'Edit',
        text: (
          <>
            Use <strong>Text editor</strong>, <strong>+Sticker</strong>, <strong>Text size</strong>,{' '}
            <strong>Text color</strong>, <strong>Background mode</strong>, and <strong>Text padding</strong>.
          </>
        ),
      },
      {
        step: 'Render',
        text: (
          <>
            Press <strong>Render</strong>, then review <strong>Result</strong> and use{' '}
            <strong>Download ZIP</strong>.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is Creative Editor for?',
        answer:
          'It is for quick production edits when a set of creative images needs consistent text, layout, background, or export settings.',
      },
      {
        question: 'Can one setup apply to multiple images?',
        answer:
          'A batch can use the same output settings, which keeps creative variations consistent across the result set.',
      },
      {
        question: 'How is this different from resizing?',
        answer:
          'Resizing focuses on crop, dimensions, and file weight. Editing adds visual layers and composition controls.',
      },
    ],
    related: [
      {
        href: '/creative-resizer.html',
        label: 'Creative Resizer',
        description: 'Crop, resize, and compress image batches before editing.',
      },
      {
        href: '/creative-renamer.html',
        label: 'Asset Renamer',
        description: 'Rename exported creatives and download the ZIP.',
      },
    ],
  },
  renamer: {
    kicker: 'Bulk asset renamer',
    title: 'Rename uploaded files from groups and identifiers',
    intro:
      'Upload files, fill Input data with Group name and Identifier, choose naming options, then copy names or download the renamed files as a ZIP.',
    details: [
      { label: 'Groups', value: 'Folder-like paths' },
      { label: 'Names', value: 'Structured output' },
      { label: 'Meta', value: 'Size and format' },
      { label: 'Export', value: 'CSV or ZIP' },
    ],
    instructions: [
      {
        step: 'Upload',
        text: (
          <>
            Press <strong>Upload ZIPs or files</strong> and decide whether to keep{' '}
            <strong>Preserve folder structure in ZIP</strong>.
          </>
        ),
      },
      {
        step: 'Name',
        text: (
          <>
            Edit <strong>Input data</strong> rows with <strong>Group name</strong>,{' '}
            <strong>Identifier</strong>, <strong>Separator</strong>, <strong>Include size in name</strong>,
            and <strong>Include format in name</strong>.
          </>
        ),
      },
      {
        step: 'Export',
        text: (
          <>
            Check <strong>Result</strong>, then use <strong>Copy names</strong>, <strong>Export CSV</strong>,
            or <strong>Download ZIP</strong>.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is a bulk file renamer?',
        answer:
          'It creates many new file names from a shared structure, reducing manual edits in large asset batches.',
      },
      {
        question: 'Why use groups in file names?',
        answer:
          'Groups preserve campaign, placement, language, or concept structure directly inside the exported file names.',
      },
      {
        question: 'Can mixed assets be renamed together?',
        answer:
          'Image, video, and general file batches can be organized together when they share a naming structure.',
      },
    ],
    related: [
      {
        href: '/creative-resizer.html',
        label: 'Creative Resizer',
        description: 'Prepare image dimensions and file weight before naming.',
      },
      {
        href: '/creative-editor.html',
        label: 'Creative Editor',
        description: 'Edit creative images before final file naming.',
      },
    ],
  },
  utm: {
    kicker: 'UTM campaign URL builder',
    title: 'Create UTM URLs from landing pages and parameter rows',
    intro:
      'Paste landing pages, fill parameter Value rows in Input data, and Result shows generated URLs for copying or CSV export.',
    details: [
      { label: 'Source', value: 'Traffic origin' },
      { label: 'Medium', value: 'Channel type' },
      { label: 'Campaign', value: 'Promotion name' },
      { label: 'Export', value: 'URLs or CSV' },
    ],
    instructions: [
      {
        step: 'Paste LPs',
        text: (
          <>
            Paste landing pages into <strong>Paste URL (landing page)</strong>.
          </>
        ),
      },
      {
        step: 'Fill values',
        text: (
          <>
            In <strong>Input data</strong>, fill each <strong>Value</strong> row and use{' '}
            <strong>Add row</strong> or <strong>Add children</strong> for more parameters.
          </>
        ),
      },
      {
        step: 'Export',
        text: (
          <>
            Check <strong>Result</strong>, then use <strong>Copy URLs</strong> or <strong>Export CSV</strong>.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is a UTM generator?',
        answer:
          'It builds URLs with campaign parameters so traffic can be grouped and analyzed in analytics tools.',
      },
      {
        question: 'Which UTM fields matter most?',
        answer:
          'Source, medium, and campaign are usually the core fields; term, content, and id add more detailed tracking.',
      },
      {
        question: 'Why generate UTM links in bulk?',
        answer:
          'Bulk generation keeps naming consistent when one campaign has many links, placements, or creative variants.',
      },
    ],
    related: [
      {
        href: '/share-splitter.html',
        label: 'Share Splitter',
        description: 'Split campaign totals into shares and grouped values.',
      },
      {
        href: '/',
        label: 'Number Cruncher',
        description: 'Adjust pasted number lists before building URL outputs.',
      },
    ],
  },
  screen: {
    kicker: 'Browser screen recorder',
    title: 'Record a screen, tab, or window in the browser',
    intro:
      'Choose Output Resolution, Frames Per Second, Audio Source, and File Format, then press Start Recording and save the recording locally.',
    details: [
      { label: 'Capture', value: 'Screen, tab, window' },
      { label: 'Audio', value: 'System and mic' },
      { label: 'Camera', value: 'Optional overlay' },
      { label: 'Output', value: 'WebM or MP4' },
    ],
    instructions: [
      {
        step: 'Setup',
        text: (
          <>
            In <strong>Capture Setup</strong>, choose <strong>Output Resolution</strong>,{' '}
            <strong>Frames Per Second</strong>, <strong>Audio Source</strong>, and{' '}
            <strong>File Format</strong>.
          </>
        ),
      },
      {
        step: 'Options',
        text: (
          <>
            Set <strong>Show Cursor</strong>, <strong>Enable Webcam</strong>, and{' '}
            <strong>Round Camera</strong> before pressing <strong>Start Recording</strong>.
          </>
        ),
      },
      {
        step: 'Save',
        text: (
          <>
            After <strong>Recording Complete</strong>, use <strong>Save Recording</strong>,{' '}
            <strong>Download in Browser</strong>, or <strong>Close</strong>.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What can a browser screen recorder capture?',
        answer:
          'It can capture a selected screen, browser tab, or window, depending on what the browser and operating system allow.',
      },
      {
        question: 'Why does MP4 conversion take longer?',
        answer:
          'MP4 output requires local video conversion after recording, which is heavier than saving the browser-native WebM file.',
      },
      {
        question: 'Does recording need an upload?',
        answer:
          'The capture and save workflow runs locally in the browser; the selected recording is not uploaded by the tool.',
      },
    ],
    related: [
      {
        href: '/whats-new.html',
        label: "What's new",
        description: 'Review recent updates for Screen Recorder and other tools.',
      },
      {
        href: '/creative-editor.html',
        label: 'Creative Editor',
        description: 'Prepare visual assets after recording or screen capture.',
      },
    ],
  },
  'whats-new': {
    kicker: 'Release notes',
    title: 'See what changed on the site',
    intro:
      'Release notes show dated changes, new tools, fixes, and behavior updates so users can understand what changed before using a workflow.',
    details: [
      { label: 'Tools', value: 'Launch history' },
      { label: 'Fixes', value: 'Behavior changes' },
      { label: 'Updates', value: 'Workflow polish' },
      { label: 'Archive', value: 'Dated notes' },
    ],
    instructions: [
      {
        step: 'Open',
        text: (
          <>
            Use the menu item <strong>What's new</strong> to open the release log.
          </>
        ),
      },
      {
        step: 'Read',
        text: (
          <>
            Scan <strong>Release notes</strong> from the newest dated section downward.
          </>
        ),
      },
      {
        step: 'Follow',
        text: (
          <>
            Open the related tool link such as <strong>Creative Resizer</strong>,{' '}
            <strong>Percent Cruncher</strong>, or <strong>Screen Recorder</strong>.
          </>
        ),
      },
    ],
    faqs: [
      {
        question: 'What is listed in the release notes?',
        answer:
          'The page lists dated launches, fixes, and workflow improvements across the Number Cruncher tool set.',
      },
      {
        question: 'Why keep a public update log?',
        answer:
          'A public log makes changes easier to audit when a tool behavior, page, or export flow has been updated.',
      },
      {
        question: 'How often is the page updated?',
        answer:
          'The page is updated when a meaningful feature, fix, or production workflow improvement ships.',
      },
    ],
    related: [
      {
        href: '/screen-recorder.html',
        label: 'Screen Recorder',
        description: 'Record a screen, tab, window, audio, and webcam.',
      },
      {
        href: '/creative-resizer.html',
        label: 'Creative Resizer',
        description: 'Resize and compress creative image batches.',
      },
      {
        href: '/bulk-percent.html',
        label: 'Percent Cruncher',
        description: 'Calculate markup, margin, initial sum, and final sum.',
      },
    ],
  },
};

function SeoWorkflow({ guide, className = '' }: { guide: SeoGuideContent; className?: string }) {
  return (
    <div className={`tool-seo-workflow${className ? ` ${className}` : ''}`} aria-label={`${guide.kicker} workflow`}>
      {guide.instructions.map((item, index) => (
        <article key={item.step}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <p className="tool-seo-workflow-title">{item.step}</p>
            <p>{item.text}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function HowToUse({ page, children }: { page: SeoGuidePage; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const guide = seoGuides[page];
  const panelId = useId();

  return (
    <div className={`how-to-use${isOpen ? ' is-open' : ''}`}>
      <p className="controls-subtitle">
        {children}{' '}
        <button
          type="button"
          className="how-to-use-toggle"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span>How to use</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </p>
      <div id={panelId} className="how-to-use-panel">
        <SeoWorkflow guide={guide} className="how-to-use-workflow" />
      </div>
    </div>
  );
}

export function SeoGuide({ page }: { page: SeoGuidePage }) {
  const guide = seoGuides[page];
  const titleId = `${page}-seo-title`;

  return (
    <section className="tool-seo-guide" aria-labelledby={titleId}>
      <div className="tool-seo-intro">
        <p className="tool-seo-kicker">{guide.kicker}</p>
        <h2 id={titleId}>{guide.title}</h2>
        <p>{guide.intro}</p>
      </div>
      <div className="tool-seo-detail-grid" aria-label={`${guide.kicker} key details`}>
        {guide.details.map((item) => (
          <div className="tool-seo-detail" key={item.label}>
            <span>{item.label}</span>
            <code>{item.value}</code>
          </div>
        ))}
      </div>
      <div className="tool-seo-faq-grid" aria-label={`${guide.kicker} quick answers`}>
        {guide.faqs.map((item) => (
          <article key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
      {guide.related?.length ? (
        <nav className="tool-seo-related" aria-label={`${guide.kicker} related tools`}>
          <span>Related tools</span>
          <div>
            {guide.related.map((item) => (
              <a href={item.href} key={item.href}>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </a>
            ))}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
