const { debug, log } = require('./log');

let trxId = 0;

function waitForEvent(api, pallet, method, onFinalize = true) {
  return new Promise((resolve, reject) => {
    api.query.system.events((events) => {

      // Loop through the Vec<EventRecord>
      events.forEach(({ event }) => {
        debug(`Found event: ${event.section}:${event.method}`);
        if (event.section === pallet && event.method === method) {
          return resolve(event);
        }
      });
    });
  });
}

function sendAndWaitForEvents(call, api, onFinalize = true) {
  return new Promise((resolve, reject) => {
    let unsub;
    let id = trxId++;
    let debugMsg = (msg) => {
      debug(() => `sendAndWaitForEvents[id=${id}] - ${msg}`);
    }

    call.send(({ events = [], status }) => {
      debugMsg(`Current status is ${status}`);

      let doResolve = (events) => {
        unsub(); // Note: unsub isn't apparently working, but we _are_ calling it

        let failures = events
          .filter(({ event }) =>
            api.events.system.ExtrinsicFailed.is(event)
          )
          // we know that data for system.ExtrinsicFailed is
          // (DispatchError, DispatchInfo)
          .map(({ event: { data: [error, info] } }) => {
            if (error.isModule) {
              // for module errors, we have the section indexed, lookup
              const decoded = api.registry.findMetaError(error.asModule);
              const { documentation, method, section } = decoded;

              return new Error(`DispatchError: ${section}.${method}: ${documentation.join(' ')}`);
            } else {
              // Other, CannotLookup, BadOrigin, no extra info
              return new Error(`DispatchError: ${error.toString()}`);
            }
          });

        if (failures.length > 0) {
          reject(failures[0]);
        } else {
          resolve(events);
        }
      };

      if (status.isInBlock) {
        debugMsg(`Transaction included at blockHash ${status.asInBlock}`);
        if (!onFinalize) {
          doResolve(events);
        }
      } else if (status.isFinalized) {
        debugMsg(`Transaction finalized at blockHash ${status.asFinalized}`);
        if (onFinalize) {
          doResolve(events);
        }
      } else if (status.isInvalid) {
        reject("Transaction failed (Invalid)");
      }
    }).then((unsub_) => unsub = unsub_);

    debugMsg(`Submitted unsigned transaction...`);
  });
}

function findEvent(events, pallet, method) {
  return events.find(({ event }) => event.section === pallet && event.method === method);
}

function getEventData(event) {
  if (event.event) { // Events are sometimes wrapped, let's make it easy for the caller
    event = event.event;
  }
  const types = event.typeDef;

  return event.data.reduce((acc, value, index) => {
    let key = types[index].type;
    debug(() => `getEventData: ${key}=${value.toString()}`);
    return {
      ...acc,
      [key]: value.toJSON()
    };
  }, {});
}

module.exports = {
  findEvent,
  getEventData,
  sendAndWaitForEvents,
  waitForEvent
};