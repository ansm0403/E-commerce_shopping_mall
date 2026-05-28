'use client'

import { ReactNode } from "react";
import Image from "next/image";

interface BannerSectionProps {
    children: ReactNode;
    backgroundImage?: string;
    backgroundColor?: string;
}

export default function BannerSection({
    children,
    backgroundImage,
    backgroundColor = '#f5f5f5'
}: BannerSectionProps) {
    return (
        <div
            className="relative w-screen ml-[calc(-50vw_+_50%)] mr-[calc(-50vw_+_50%)] overflow-hidden"
            style={{ backgroundColor }}
        >
            {backgroundImage && (
                <Image
                    src={backgroundImage}
                    alt=""
                    aria-hidden
                    fill
                    priority
                    sizes="100vw"
                    className="object-cover blur-[8px] z-0"
                />
            )}
            <div className="relative max-w-[1200px] mx-auto px-4 z-[1]">
                {children}
            </div>
        </div>
    );
}
