import Image from "next/image";

/** The Teacher, drawn as the Ape mascot. Always circular. */
export function Mascot({ size, preload }: { size: number; preload?: boolean }) {
  return (
    <Image
      src="/ape-mascot.png"
      alt="Ape, your teacher"
      width={size}
      height={size}
      preload={preload}
      className="mascot"
    />
  );
}
