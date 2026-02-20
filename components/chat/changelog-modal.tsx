"use client";

import Image from "next/image";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

interface Changelog {
    id: number;
    version: string;
    title: string;
    content: string;
    image_url: string | null;
}

interface ChangelogModalProps {
    changelog: Changelog;
    onClose: () => void;
}

export function ChangelogModal({ changelog, onClose }: ChangelogModalProps) {
    const handleClose = async () => {
        onClose();
        try {
            await fetch("/api/changelog/seen", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ changelogId: changelog.id }),
            });
        } catch (err) {
            console.error("Error marking changelog as seen:", err);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
            <DialogContent className="sm:max-w-md" showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="size-5 text-yellow-500" />
                        <span>{changelog.title}</span>
                        <span className="text-xs font-normal text-muted-foreground">v{changelog.version}</span>
                    </DialogTitle>
                </DialogHeader>

                <div
                    className="[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_li]:text-sm [&_li]:text-muted-foreground [&_strong]:text-foreground [&_strong]:font-medium [&_p]:text-sm [&_p]:text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: changelog.content }}
                />

                {changelog.image_url && (
                    <div className="relative w-full aspect-video overflow-hidden rounded-md">
                        <Image
                            src={changelog.image_url}
                            alt={changelog.title}
                            fill
                            className="object-cover"
                            sizes="(max-width: 448px) 100vw, 448px"
                        />
                    </div>
                )}

                <DialogFooter>
                    <Button onClick={handleClose} className="w-full sm:w-auto">
                        Entendido
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
