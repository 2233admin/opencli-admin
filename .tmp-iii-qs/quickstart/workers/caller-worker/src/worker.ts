import { registerWorker } from 'iii-sdk';
import { Logger } from '@iii-dev/observability';

const worker = registerWorker(process.env.III_URL ?? 'ws://localhost:49134');
const logger = new Logger();

worker.registerFunction(
  'math::add_two_numbers',
  async (payload: { a: number; b: number }) => {
    logger.info('math::add_two_numbers called in TypeScript', payload);

    const result = await worker.trigger({
      function_id: 'math::add',
      payload,
    });

    return {
      ...result,
      success:
        "You've connected two workers and they're interoperating seamlessly, now let's add a few more workers to expand this project's functionality.",
    };
  },
);

// --- Uncomment after: iii worker add iii-http ---
// worker.registerFunction(
//   'http::add_two_numbers',
//   async (payload: { body: { a: number; b: number } }) => {
//     const result = await worker.trigger({
//       function_id: 'math::add_two_numbers',
//       payload: payload.body,
//     });
//     return {
//       status_code: 200,
//       body: { c: result.c, running_total: result.running_total },
//       headers: { 'Content-Type': 'application/json' },
//     };
//   },
// );

// worker.registerTrigger({
//   type: 'http',
//   function_id: 'http::add_two_numbers',
//   config: { api_path: '/math/add-two-numbers', http_method: 'POST' },
// });

console.log('Caller worker started - listening for calls');
