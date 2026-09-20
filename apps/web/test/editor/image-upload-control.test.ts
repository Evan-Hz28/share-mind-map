import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";

import ImageUploadControl from "../../src/editor/assets/ImageUploadControl.vue";

describe("ImageUploadControl", () => {
  it("accepts file, paste and drop through one upload path", async () => {
    const upload = vi
      .fn<(file: File) => Promise<string>>()
      .mockResolvedValue("00000000-0000-7000-8000-000000000111");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { emitted } = render(ImageUploadControl, {
      props: { disabled: false, upload: (file: File) => upload(file) },
    });
    const file = new File([new Uint8Array([137, 80, 78, 71])], "map.png", {
      type: "image/png",
    });

    await fireEvent.change(screen.getByLabelText("选择图片"), { target: { files: [file] } });
    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    await fireEvent.paste(screen.getByRole("button", { name: "上传图片" }), {
      clipboardData: { files: [file] },
    });
    await fireEvent.drop(screen.getByRole("button", { name: "上传图片" }), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(3);
    });
    expect(emitted("asset-selected")).toHaveLength(3);
  });

  it("rejects unsupported media before making a request", async () => {
    const upload = vi.fn<(file: File) => Promise<string>>();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { emitted } = render(ImageUploadControl, {
      props: { disabled: false, upload: (file: File) => upload(file) },
    });
    const file = new File(["not an image"], "map.svg", { type: "image/svg+xml" });

    await fireEvent.change(screen.getByLabelText("选择图片"), { target: { files: [file] } });
    expect(upload).not.toHaveBeenCalled();
    expect(emitted("rejected")).toHaveLength(1);
  });
});
