import DOMPurify from "dompurify";

const urlRegex = /https?:\/\/[^\s]+/g;

function isHTML(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

export default function textLink(text: string): JSX.Element {
  // If the text contains HTML, sanitize and render it directly
  if (isHTML(text)) {
    const sanitizedHTML = DOMPurify.sanitize(text, {
      ALLOWED_TAGS: ["a"],
      ALLOWED_ATTR: ["href", "target", "rel"],
    });

    return (
      <div
        className="[&_a]:underline"
        dangerouslySetInnerHTML={{ __html: sanitizedHTML }}
      />
    );
  }

  // Otherwise, handle it as plain text with URL detection
  const parts = text.split(urlRegex);
  const matches = text.match(urlRegex) ?? [];

  const result = parts.reduce(
    (arr, part, i) => {
      arr.push(DOMPurify.sanitize(part));
      const match = matches[i];
      if (match) {
        arr.push(
          <a
            key={i}
            href={matches[i]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {DOMPurify.sanitize(match)}
          </a>,
        );
      }
      return arr;
    },
    [] as (string | JSX.Element)[],
  );

  return <>{result}</>;
}
