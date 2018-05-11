import EventEmitter from 'events'
import {
  parse,
  subscribe,
  GraphQLSchema,
  GraphQLObjectType,
} from 'graphql'
import tql from 'typiql'

import {
  GraphQLLiveData,
  subscribeToLiveData,
} from './'

const HouseGraphQLType = new GraphQLObjectType({
  name: 'House',
  fields: () => ({
    id: {
      type: tql`ID!`
    },
    address: {
      args: {
        includePostalCode: {
          type: tql`Boolean!`,
        },
      },
      type: tql`String!`
    },
    numberOfCats: {
      type: tql`Int!`
    },
    numberOfDogs: {
      type: tql`Int!`
    },
  }),
})

const HouseLiveData = () => {
  return GraphQLLiveData({
    name: 'HouseLiveData',
    type: tql`[${HouseGraphQLType}!]`,
  })
}

const externallyGeneratedPatch = [
  {
    op: 'replace',
    path: '/1/address',
    value: '42 Patch Event St.',
  }
]

const createTestSubscription = async ({ trackState }) => {
  let emitUpdateInner, patchCB
  const emitUpdate = () => emitUpdateInner()
  const emitPatch = patch => patchCB(patch)
  const state = [
    {
      id: 'real_street',
      address: '123 real st',
      numberOfCats: 5,
      numberOfDogs: 7,
    },
    {
      id: 'legit_road',
      address: '200 legit rd',
      numberOfCats: 0,
      numberOfDogs: 1,
    },
  ]
  const store = {
    subscribe: cb => emitUpdateInner = cb,
    getState: () => state,
  }
  const onPatch = cb => patchCB = cb

  const schema = new GraphQLSchema({
    query: HouseGraphQLType,
    subscription: new GraphQLObjectType({
      name: 'SubscriptionRoot',
      fields: () => ({
        houses: {
          type: HouseLiveData(),
          resolve: source => source,
          subscribe: subscribeToLiveData({
            fieldName: 'houses',
            type: HouseLiveData(),
            trackState,
            initialState: (
              source,
              args,
              context,
              resolveInfo,
            ) => {
              return context.store.getState()
            },
            eventEmitter: async (
              source,
              args,
              context,
              resolveInfo,
            ) => {
              /* creating a new EventEmitter */
              const eventEmitter = new EventEmitter()
              /*
               * patches can either be generated by graphql-live-subscription by
               * internally comparing the previous state to the next state or by
               * providing a RFC6902 patch array.
               *
               * This if statement is here to demonstrate both methods although
               * in most real-world application you will generally only need one
               * (ie. either 'update' or 'patch' but not both).
               *
               * If you need to use both that's cool too. You do you.
               *
               * here we are triggering an 'update' event.
               * graphql-live-subscriptions will generate a patch for us
               * by comparing the next state to the previous state.
               *
               * Depending on your usecase this may be the simplest way to
               * send a patch to your GraphQL client however it will not be as
               * performant as sending a 'patch' event if you have the
               * patch data already generated.
               */
               context.store.subscribe(() => {
                 eventEmitter.emit('update', {
                   nextState: context.store.getState(),
                 })
               })

              /*
               * here we are emiting a 'patch' event and avoid the overhead
               * of graphql-live-subscriptions diffing the previous and next
               * states. This can be useful if your server has patch data
               * already generated (eg. if your database provides patches
               * or if you can generate them faster by
               * using application-specific logic).
               */
               context.onPatch(() => {
                 eventEmitter.emit('patch', {
                   patch: externallyGeneratedPatch,
                 })
               })
              /* returning the eventEmitter to graphql-live-subscriptions */
              return eventEmitter
            },
          }),
        }
      })
    }),
  })

  const document = parse(`
    subscription($includePostalCode: Boolean!) {
      houses {
        ...CatQueryFragment
        query {
          ... on House {
            id
          }
          address(includePostalCode: $includePostalCode)
        }
        patch { op, path, from, value }
      }
    }

    fragment CatQueryFragment on HouseLiveData {
      query {
        numberOfCats
      }
    }
  `)

  let subscription = subscribe({
    schema,
    document,
    contextValue: {
      store,
      onPatch,
    },
    variableValues: {
      includePostalCode: false,
    },
  })


  if (subscription.then != null) subscription = await subscription

  if (subscription.errors != null) {
    expect(JSON.stringify(subscription.errors)).toEqual(null)
  }

  return {
    subscription,
    emitUpdate,
    emitPatch,
    state,
  }
}

const expectSubscriptionResponse = async (subscription) => {
  const result = await subscription.next()

  expect(result.done).toEqual(false)
  expect(result.value.data).toMatchSnapshot()
}

describe('GraphQLLiveData Integration', () => {
  it('publishes the initialQuery immediately', async () => {
    const { subscription, emitUpdate, state } = await createTestSubscription({})

    await expectSubscriptionResponse(subscription)
  })

  it('publishes patches on \'update\'', async () => {
    const { subscription, emitUpdate, state } = await createTestSubscription({})
    // inital query
    await subscription.next()
    // null change should not create a response
    emitUpdate()
    // first patch
    state[0].numberOfDogs = 0
    state[0].numberOfCats = 200
    emitUpdate()
    await expectSubscriptionResponse(subscription)
    // second patch
    state[0].address = state[0].address + ' apt. 1'
    state[1].address = state[1].address + ' apt. 2'
    emitUpdate()
    await expectSubscriptionResponse(subscription)
  })

  it('publishes a patch on \'patch\'', async () => {
    const {
      subscription,
      emitUpdate,
      emitPatch,
      state,
    } = await createTestSubscription({})
    // inital query
    await subscription.next()
    // first patch
    emitPatch()
    await expectSubscriptionResponse(subscription)
    // second patch
    state[0].address = state[0].address + ' apt. 1'
    state[1].address = externallyGeneratedPatch[0].value
    emitUpdate()
    await expectSubscriptionResponse(subscription)
  })

  describe('when trackState is false', () => {
    // it('errors on \'update\' and closes the subcription', async () => {
    //   const {
    //     subscription,
    //     emitUpdate,
    //     emitPatch,
    //     state,
    //   } = await createTestSubscription({trackState: false})
    //   // inital query
    //   await subscription.next()
    //   // first patch
    //   state[0].address = state[0].address + ' apt. 1'
    //   emitUpdate()
    //   const result = await subscription.next()
    //
    //   expect(result.done).toEqual(true)
    // })

    it('publishes a patch on \'patch\'', async () => {
      const {
        subscription,
        emitUpdate,
        emitPatch,
        state,
      } = await createTestSubscription({trackState: false})
      // inital query
      await subscription.next()
      // first patch
      emitPatch()
      await expectSubscriptionResponse(subscription)
    })
  })

})
