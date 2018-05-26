import {
  isListType,
  isLeafType,
  isNonNullType,
  responsePathAsArray,
  defaultFieldResolver,
} from 'graphql'
import {
  getFieldDef,
  buildResolveInfo,
  resolveFieldValueOrError,
} from 'graphql/execution/execute'

import updateChildNodes from './updateChildNodes'

export const UNCHANGED = Symbol('UNCHANGED')

export const createNode = ({
  exeContext,
  parentType,
  type,
  fieldNodes,
  graphqlPath,
  sourceRootConfig,
}) => {
  const name = fieldNodes[0].name.value
  const parentRoots = sourceRootConfig[parentType.name]

  const isSourceRoot = (
    parentType.name && name && parentRoots && parentRoots[name]
  )

  const reactiveNode = {
    isLeaf: isLeafType(type),
    isList: isListType(type),
    isListEntry: isListType(parentType),
    name,
    // eg. if path is ['live', 'query', 'foo'] then patchPath is '/foo'
    patchPath: `/${responsePathAsArray(graphqlPath).slice(2).join('/')}`,
    children: [],
    value: undefined,
    exeContext,
    parentType,
    type: isNonNullType(type) ? type.ofType : type,
    fieldNodes,
    sourceRootConfig,
    isSourceRoot,
    graphqlPath,
  }

  if (isSourceRoot) {
    parentRoots[name][reactiveNode.patchPath] = reactiveNode
  }

  return reactiveNode
}

/**
 * Resolves the field on the given source object. In particular, this
 * figures out the value that the field returns by calling its resolve function,
 * then calls completeValue to complete promises, serialize scalars, or execute
 * the sub-selection-set for objects.
 */
const resolveField = (reactiveNode, source) => {
  const {
    exeContext,
    parentType,
    fieldNodes,
    graphqlPath,
  } = reactiveNode

  const fieldName = fieldNodes[0].name.value

  // console.log('before', reactiveNode.patchPath, fieldNodes[0].name.value, source)
  if (reactiveNode.isListEntry) return source

  const fieldDef = getFieldDef(exeContext.schema, parentType, fieldName)
  if (!fieldDef) {
    return null
  }

  const resolveFn = fieldDef.resolve || defaultFieldResolver

  const info = buildResolveInfo(
    exeContext,
    fieldDef,
    fieldNodes,
    parentType,
    graphqlPath,
  )

  // Get the resolve function, regardless of if its result is normal
  // or abrupt (error).
  const result = resolveFieldValueOrError(
    exeContext,
    fieldDef,
    fieldNodes,
    resolveFn,
    source,
    info,
  )

  console.log('after', fieldNodes[0].name.value, reactiveNode.patchPath, fieldDef.type, source, result)
  return result
}

export const setInitialValue = (reactiveNode, source) => {
  // eslint-disable-next-line no-param-reassign
  reactiveNode.value = resolveField(reactiveNode, source)

  updateChildNodes(reactiveNode)

  return reactiveNode.value
}

export const getNextValueOrUnchanged = (reactiveNode, source) => {
  const previousValue = reactiveNode.value
  const nextValue = resolveField(reactiveNode, source)

  console.log(reactiveNode.patchPath, nextValue)

  if (nextValue === previousValue) return UNCHANGED

  // eslint-disable-next-line no-param-reassign
  reactiveNode.value = nextValue

  // updateChildNodes(reactiveNode)

  return nextValue
}
