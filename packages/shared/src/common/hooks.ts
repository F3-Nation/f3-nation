import React, { useEffect, useState } from "react";

export const useOnKeyPress = <T extends HTMLElement>({
  key,
  cb,
}: {
  key?: string;
  cb: (key?: string) => void;
}) => {
  const ref = React.useRef<T>(null);

  ref.current?.addEventListener("keypress", function (event) {
    // If the user presses the "Enter" key on the keyboard
    console.log(event.key);
    if (!key || event.key === key) {
      // Cancel the default action, if needed
      event.preventDefault();
      // Trigger the button element with a click
      cb(key);
    }
  });
  return { ref };
};

// https://react-hook-form.com/faqs#question5:~:text=%7D-,How%20to%20share%20ref%20usage%3F,-React%20Hook%20Form
// For reack hook form:
//   const { ref } = useOnKeyPress<HTMLInputElement>({
//     cb: (key) => {
//       console.log('key', key)
//     },
//   })
//   const { ref: rhfRef, ...registerEmail } = register('email')
//   useImperativeHandle(rhfRef, () => ref?.current)
//   return (
//     <input
//       {...registerEmail}
//       ref={ref}
//     />
//   )
// }

export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, [matches, query]);

  return matches;
};
