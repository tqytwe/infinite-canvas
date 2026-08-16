/**
 * Reference Slots Hook
 *
 * 管理参考图槽位的状态和持久化
 */

import { useState, useEffect } from "react";
import type { ReferenceSlot } from "@/components/canvas/reference-image-slots";
import { createDefaultSlots } from "@/components/canvas/reference-image-slots";
import type { ReferenceImage } from "@/types/image";

const STORAGE_KEY = "infinite-canvas:reference-slots";
const ACTIVE_SLOT_KEY = "infinite-canvas:active-slot";

export function useReferenceSlots(slotCount: number = 3) {
    const [slots, setSlots] = useState<ReferenceSlot[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error("Failed to load reference slots:", e);
        }
        return createDefaultSlots(slotCount);
    });

    const [activeSlotId, setActiveSlotId] = useState<string | undefined>(() => {
        try {
            const saved = localStorage.getItem(ACTIVE_SLOT_KEY);
            return saved || undefined;
        } catch (e) {
            return undefined;
        }
    });

    // 持久化槽位
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
        } catch (e) {
            console.error("Failed to save reference slots:", e);
        }
    }, [slots]);

    // 持久化激活槽位
    useEffect(() => {
        if (activeSlotId) {
            localStorage.setItem(ACTIVE_SLOT_KEY, activeSlotId);
        } else {
            localStorage.removeItem(ACTIVE_SLOT_KEY);
        }
    }, [activeSlotId]);

    const handleSlotUpdate = (slotId: string, image: ReferenceImage | null) => {
        setSlots((prev) =>
            prev.map((slot) =>
                slot.id === slotId ? { ...slot, image } : slot
            )
        );
    };

    const handleSlotActivate = (slotId: string) => {
        setActiveSlotId(slotId);
    };

    const handleSlotPin = (slotId: string, pinned: boolean) => {
        setSlots((prev) =>
            prev.map((slot) =>
                slot.id === slotId ? { ...slot, pinned } : slot
            )
        );
    };

    const handleSlotLabelChange = (slotId: string, label: string) => {
        setSlots((prev) =>
            prev.map((slot) =>
                slot.id === slotId ? { ...slot, label } : slot
            )
        );
    };

    // 获取当前激活槽位的图片
    const getActiveReferenceImage = (): ReferenceImage | null => {
        if (!activeSlotId) return null;
        const activeSlot = slots.find((s) => s.id === activeSlotId);
        return activeSlot?.image || null;
    };

    // 清除所有非固定槽位
    const clearUnpinnedSlots = () => {
        setSlots((prev) =>
            prev.map((slot) =>
                slot.pinned ? slot : { ...slot, image: null, label: undefined }
            )
        );
    };

    return {
        slots,
        activeSlotId,
        handleSlotUpdate,
        handleSlotActivate,
        handleSlotPin,
        handleSlotLabelChange,
        getActiveReferenceImage,
        clearUnpinnedSlots,
    };
}
