import { fromPartial } from "@total-typescript/shoehorn";
import FetchMock from "fetch-mock-jest";
import { Context, EventPayload, Inngest, InngestMiddleware } from "inngest";
import {
  ExecutionResult,
  ExecutionVersion,
  InngestExecutionOptions,
} from "inngest/components/execution/InngestExecution";
import { _internals } from "inngest/components/execution/v1";
import { SendEventPayload } from "inngest/helpers/types";
import { encryptionMiddleware, EncryptionService } from "./middleware";

const id = "test-client";
const key = "123";
const baseUrl = "https://unreachable.com";
const eventKey = "123";
const fetchMock = FetchMock.sandbox();

const partialEncryptedValue = {
  [EncryptionService.ENCRYPTION_MARKER]: true,
  [EncryptionService.STRATEGY_MARKER]: "libsodium",
  data: expect.any(String),
};

describe("encryptionMiddleware", () => {
  describe("return", () => {
    test("returns an InngestMiddleware", () => {
      const mw = encryptionMiddleware({ key });
      expect(mw).toBeInstanceOf(InngestMiddleware);
    });

    test("requires a key", () => {
      expect(() => {
        // @ts-expect-error
        encryptionMiddleware({});
      }).toThrowError("Missing encryption key");
    });
  });

  describe("client", () => {
    afterEach(() => {
      fetchMock.mockReset();
    });

    const mockSend = (
      inngest: Inngest.Any,
      payload: SendEventPayload<Record<string, EventPayload>>
    ): Promise<EventPayload> => {
      return new Promise(async (resolve, reject) => {
        fetchMock.post(`${baseUrl}/e/${eventKey}`, (url, req) => {
          resolve(JSON.parse(req.body as string)[0]);

          const res = new Response(JSON.stringify({ foo: "bar" }), {
            status: 200,
          });

          return res;
        });

        inngest.send(payload).catch(() => undefined);
      });
    };

    test("does not encrypt a sent event by default", async () => {
      const inngest = new Inngest({
        id,
        fetch: fetchMock as typeof fetch,
        baseUrl,
        eventKey,
        middleware: [encryptionMiddleware({ key })],
      });

      const evt = await mockSend(inngest, {
        name: "my.event",
        data: { foo: "bar" },
      });

      expect(evt).toMatchObject({
        name: "my.event",
        data: { foo: "bar" },
      });
    });

    test("encrypts a sent event", async () => {
      const inngest = new Inngest({
        id,
        fetch: fetchMock as typeof fetch,
        baseUrl,
        eventKey,
        middleware: [encryptionMiddleware({ key, encryptEventData: true })],
      });

      const evt = await mockSend(inngest, {
        name: "my.event",
        data: { foo: "bar" },
      });

      expect(evt).toMatchObject({
        name: "my.event",
        data: {
          [EncryptionService.ENCRYPTION_MARKER]: true,
          [EncryptionService.STRATEGY_MARKER]: "libsodium",
          data: expect.any(String),
        },
      });
    });
  });

  describe("spec", () => {
    const todoSpecs: string[] = ["encrypts a function's return data"];

    todoSpecs.forEach((name) => {
      test.todo(name);
    });

    const runSpecs = (specs: Specification[]) => {
      specs.forEach((spec) => {
        if (spec.todo) {
          test.todo(spec.name);
        }

        test(spec.name, async () => {
          const result = await runFn({ spec });
          expect(result).toMatchObject(spec.result);
        });
      });
    };

    describe("step encryption", () => {
      const fn: Specification["fn"] = async ({ step }) => {
        const foo = await step.run("foo", () => {
          return { foo: "foo" };
        });

        const bar = await step.run("bar", () => {
          return { foowas: foo, bar: "bar" };
        });

        return { foo, bar };
      };

      const stepIds = {
        foo: _internals.hashId("foo"),
        bar: _internals.hashId("bar"),
      };

      runSpecs([
        {
          name: "encrypts a run step",
          fn,
          result: {
            type: "step-ran",
            step: fromPartial({
              data: partialEncryptedValue,
            }),
          },
        },
        {
          name: "decrypts and encrypts a following step",
          fn,
          result: {
            type: "step-ran",
            step: fromPartial({
              data: partialEncryptedValue,
            }),
          },
          steps: {
            [stepIds.foo]: {
              id: stepIds.foo,
              data: {
                [EncryptionService.ENCRYPTION_MARKER]: true,
                [EncryptionService.STRATEGY_MARKER]: "libsodium",
                data: "OO3gyBNd7yWI2BIVI4sFwH/+iYwB+Vo/PG8HjNE/+iwwg0KDaxmlWElMNYw7YZnsmitPkos=",
              },
            },
          },
        },
        {
          name: "returns decrypted data",
          fn,
          result: {
            type: "function-resolved",
            data: {
              foo: { foo: "foo" },
              bar: { foowas: { foo: "foo" }, bar: "bar" },
            },
          },
          steps: {
            [stepIds.foo]: {
              id: stepIds.foo,
              data: {
                [EncryptionService.ENCRYPTION_MARKER]: true,
                [EncryptionService.STRATEGY_MARKER]: "libsodium",
                data: "OO3gyBNd7yWI2BIVI4sFwH/+iYwB+Vo/PG8HjNE/+iwwg0KDaxmlWElMNYw7YZnsmitPkos=",
              },
            },
            [stepIds.bar]: {
              id: stepIds.bar,
              data: {
                [EncryptionService.ENCRYPTION_MARKER]: true,
                [EncryptionService.STRATEGY_MARKER]: "libsodium",
                data: "9mVeJCrWDEcurAb6sDlELJtg9y51wcuR/IjLoAB2CnPGA3MOLa4ae9KuSWzpvqmy3Idm3Fjo++m6qlZmhLHI9qr9HSCRah0QisELHQ==",
              },
            },
          },
        },
      ]);
    });
  });
});

type Specification = {
  name: string;
  todo?: boolean;
  steps?: InngestExecutionOptions["stepState"];
  events?: [EventPayload, ...EventPayload[]];
  fn: (ctx: Context) => unknown;
  result: ExecutionResult;
};

const runFn = async ({
  spec: {
    fn: testFn,
    steps = {},
    events = [{ name: "my-event", data: { foo: "bar" } }],
  },
}: {
  spec: Specification;
}): Promise<ExecutionResult> => {
  const inngest = new Inngest({
    id: "test-client",
    middleware: [encryptionMiddleware({ key })],
  });

  const fn = inngest.createFunction(
    { id: "my-fn" },
    { event: "my-event" },
    testFn
  );

  const runId = "test-run";

  const execution = fn["createExecution"]({
    version: ExecutionVersion.V1,
    partialOptions: {
      data: {
        attempt: 0,
        event: events[0],
        events: events,
        runId,
      },
      stepState: steps,
      runId,
      stepCompletionOrder: Object.keys(steps),
      reqArgs: [],
      headers: {},
    },
  });

  const result = await execution.start();

  return result;
};
