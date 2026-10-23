import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";

import RequestErrorAlert from "../src/components/RequestErrorAlert.vue";

describe("request error alert", () => {
  it("lists the conflicting document names returned by the import API", () => {
    render(RequestErrorAlert, {
      props: {
        error: {
          code: "DOCUMENT_NAME_CONFLICT",
          message: "",
          details: {
            conflictingNames: [
              "ReviewsOptimization客户端测试用例",
              "ReviewsOptimization客户端冒烟自测用例",
            ],
          },
          requestId: "request-id",
        },
      },
    });

    expect(
      screen.getByText(
        "工作区已存在同名文档：ReviewsOptimization客户端测试用例、ReviewsOptimization客户端冒烟自测用例。请修改目标文档名后再导入。",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to the generic conflict message without names", () => {
    render(RequestErrorAlert, {
      props: {
        error: {
          code: "DOCUMENT_NAME_CONFLICT",
          message: "",
          details: {},
          requestId: "request-id",
        },
      },
    });

    expect(screen.getByText("已存在同名文档，请换一个名字。")).toBeInTheDocument();
  });

  it("explains an oversized snapshot submission", () => {
    render(RequestErrorAlert, {
      props: {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "提交内容超过大小限制。",
          details: {},
          requestId: "request-id",
        },
      },
    });

    expect(screen.getByText("提交的内容过大，请减少节点或图片后重试。")).toBeInTheDocument();
  });
});
