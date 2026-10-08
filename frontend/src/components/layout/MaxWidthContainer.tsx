'use client'

import { ReactNode } from "react";

interface MaxWidthContainerProps {
    children: ReactNode;
}

export default function MaxWidthContainer({ children }: MaxWidthContainerProps) {
    return (
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-10 w-full">
            {children}
        </div>
    );
}
