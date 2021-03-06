var get = Ember.get;
var forEach = Ember.EnumerableUtils.forEach;
var camelize = Ember.String.camelize;

import {pluralize} from "../../../ember-inflector/lib/main";

/**
  DS.EmbeddedRecordsMixin supports serializing embedded records.

  To set up embedded records, include the mixin into a serializer then define
  embedded (model) relationships.

  Below is an example of a per type serializer (post type).

  ```js
  App.PostSerializer = DS.ActiveModelSerializer.extend(DS.EmbeddedRecordsMixin, {
    attrs: {
      author: {embedded: 'always'},
      comments: {serialize: 'ids'}
    }
  })
  ```

  The `attrs` option for a resource `{embedded: 'always'}` is shorthand for:
  `{serialize: 'records', deserialize: 'records'}`. Embedded records are extracted
  from a nested document, so the default option for `deserialize` is `records`.

  When serializing, a resource's `attrs` option may be set to use `ids` or `records`
  for the `serialize` setting.

  @class EmbeddedRecordsMixin
  @namespace DS
*/
var EmbeddedRecordsMixin = Ember.Mixin.create({

  /**
    Serialize `belongsTo` relationship when it is configured as an embedded object.

    This example of an author model belongs to a post model:

    ```js
    Post = DS.Model.extend({
      title:    DS.attr('string'),
      body:     DS.attr('string'),
      author:   DS.belongsTo('author')
    });

    Author = DS.Model.extend({
      name:     DS.attr('string'),
      post:     DS.belongsTo('post')
    });
    ```

    Use a custom (type) serializer for the post model to configure embedded author

    ```js
    App.PostSerializer = DS.RESTSerializer.extend(DS.EmbeddedRecordsMixin, {
      attrs: {
        author: {embedded: 'always'}
      }
    })
    ```

    A payload with an attribute configured for embedded records can serialize
    the records together under the root attribute's payload:

    ```js
    {
      "post": {
        "id": "1"
        "title": "Rails is omakase",
        "author": {
          "id": "2"
          "name": "dhh"
        }
      }
    }
    ```

    @method serializeBelongsTo
    @param {DS.Model} record
    @param {Object} json
    @param {Object} relationship
  */
  serializeBelongsTo: function(record, json, relationship) {
    var attr = relationship.key;
    var attrs = this.get('attrs');

    var includeIds = hasSerializeIdsOption(attrs, attr) || noSerializeOptionSpecified(attrs, attr);
    var includeRecords = hasSerializeRecordsOption(attrs, attr);

    var embeddedRecord = record.get(attr);
    if (includeIds) {
      key = this.keyForRelationship(attr, relationship.kind);
      if (!embeddedRecord) {
        json[key] = null;
      } else {
        json[key] = get(embeddedRecord, 'id');
      }
    } else if (includeRecords) {
      var key = this.keyForRelationship(attr);
      if (!embeddedRecord) {
        json[key] = null;
      } else {
        json[key] = embeddedRecord.serialize({includeId: true});
        this.removeEmbeddedForeignKey(record, embeddedRecord, relationship, json[key]);
      }
    }
  },
  
  /**
    Serialize `hasMany` relationship when it is configured as embedded objects.

    This example of a post model has many comments:

    ```js
    Post = DS.Model.extend({
      title:    DS.attr('string'),
      body:     DS.attr('string'),
      comments: DS.hasMany('comment')
    });

    Comment = DS.Model.extend({
      body:     DS.attr('string'),
      post:     DS.belongsTo('post')
    });
    ```

    Use a custom (type) serializer for the post model to configure embedded comments

    ```js
    App.PostSerializer = DS.RESTSerializer.extend(DS.EmbeddedRecordsMixin, {
      attrs: {
        comments: {embedded: 'always'}
      }
    })
    ```

    A payload with an attribute configured for embedded records can serialize
    the records together under the root attribute's payload:

    ```js
    {
      "post": {
        "id": "1"
        "title": "Rails is omakase",
        "body": "I want this for my ORM, I want that for my template language..."
        "comments": [{
          "id": "1",
          "body": "Rails is unagi"
        }, {
          "id": "2",
          "body": "Omakase O_o"
        }]
      }
    }
    ```

    The attrs options object can use more specific instruction for extracting and
    serializing. When serializing, an option to embed `ids` or `records` can be set.
    When extracting the only option is `records`.

    So `{embedded: 'always'}` is shorthand for:
    `{serialize: 'records', deserialize: 'records'}`

    To embed the `ids` for a related object (using a hasMany relationship):

    ```js
    App.PostSerializer = DS.RESTSerializer.extend(DS.EmbeddedRecordsMixin, {
      attrs: {
        comments: {serialize: 'ids', deserialize: 'records'}
      }
    })
    ```

    ```js
    {
      "post": {
        "id": "1"
        "title": "Rails is omakase",
        "body": "I want this for my ORM, I want that for my template language..."
        "comments": ["1", "2"]
      }
    }
    ```

    @method serializeHasMany
    @param {DS.Model} record
    @param {Object} json
    @param {Object} relationship
  */
  serializeHasMany: function(record, json, relationship) {
    var attr = relationship.key;
    var attrs = this.get('attrs');
    var includeIds = hasSerializeIdsOption(attrs, attr);
    var includeRecords = hasSerializeRecordsOption(attrs, attr);
    var key;

    if (includeIds) {
      key = this.keyForRelationship(attr, relationship.kind);
      json[key] = get(record, attr).mapBy('id');
    } else if (includeRecords) {
      key = this.keyForAttribute(attr);
      json[key] = get(record, attr).map(function(embeddedRecord) {
        var serializedEmbeddedRecord = embeddedRecord.serialize({includeId: true});
        this.removeEmbeddedForeignKey(record, embeddedRecord, relationship, serializedEmbeddedRecord);
        return serializedEmbeddedRecord;
      }, this);
    }
  },

  /*
    When serializing an embedded record, modify the property (in the json payload)
    that refers to the parent record (foreign key for relationship).

    Serializing a `belongsTo` relationship removes the property that refers to the
    parent record

    Serializing a `hasMany` relationship does not remove the property that refers to
    the parent record.

    @method removeEmbeddedForeignKey
    @param {DS.Model} record
    @param {DS.Model} embeddedRecord
    @param {Object} relationship
    @param {Object} json
  */
  removeEmbeddedForeignKey: function (record, embeddedRecord, relationship, json) {
    if (relationship.kind === 'hasMany') {
      return;
    } else if (relationship.kind === 'belongsTo') {
      var parentRecord = record.constructor.inverseFor(relationship.key);
      if (parentRecord) {
        var name = parentRecord.name;
        var embeddedSerializer = this.store.serializerFor(embeddedRecord.constructor);
        var parentKey = embeddedSerializer.keyForRelationship(name, parentRecord.kind);
        if (parentKey) {
          delete json[parentKey];
        }
      }
    }
  },

  /**
    Extract an embedded object from the payload for a single object
    and add the object in the compound document (side-loaded) format instead.

    A payload with an attribute configured for embedded records needs to be extracted:

    ```js
    {
      "post": {
        "id": 1
        "title": "Rails is omakase",
        "author": {
          "id": 2
          "name": "dhh"
        }
        "comments": []
      }
    }
    ```

    Ember Data is expecting a payload with a compound document (side-loaded) like:

    ```js
    {
      "post": {
        "id": "1"
        "title": "Rails is omakase",
        "author": "2"
        "comments": []
      },
      "authors": [{
        "id": "2"
        "post": "1"
        "name": "dhh"
      }]
      "comments": []
    }
    ```

    The payload's `author` attribute represents an object with a `belongsTo` relationship.
    The `post` attribute under `author` is the foreign key with the id for the post

    @method extractSingle
    @param {DS.Store} store
    @param {subclass of DS.Model} primaryType
    @param {Object} payload
    @param {String} recordId
    @param {'find'|'createRecord'|'updateRecord'|'deleteRecord'} requestType
    @return Object the primary response to the original request
  */
  extractSingle: function(store, primaryType, payload, recordId) {
    var root = this.keyForAttribute(primaryType.typeKey),
        partial = payload[root];

    updatePayloadWithEmbedded(this, store, primaryType, payload, partial);

    return this._super(store, primaryType, payload, recordId);
  },

  /**
    Extract embedded objects in an array when an attr is configured for embedded,
    and add them as side-loaded objects instead.

    A payload with an attr configured for embedded records needs to be extracted:

    ```js
    {
      "post": {
        "id": "1"
        "title": "Rails is omakase",
        "comments": [{
          "id": "1",
          "body": "Rails is unagi"
        }, {
          "id": "2",
          "body": "Omakase O_o"
        }]
      }
    }
    ```

    Ember Data is expecting a payload with compound document (side-loaded) like:

    ```js
    {
      "post": {
        "id": "1"
        "title": "Rails is omakase",
        "comments": ["1", "2"]
      },
      "comments": [{
        "id": "1",
        "body": "Rails is unagi"
      }, {
        "id": "2",
        "body": "Omakase O_o"
      }]
    }
    ```

    The payload's `comments` attribute represents records in a `hasMany` relationship

    @method extractArray
    @param {DS.Store} store
    @param {subclass of DS.Model} primaryType
    @param {Object} payload
    @return {Array<Object>} The primary array that was returned in response
      to the original query.
  */
  extractArray: function(store, primaryType, payload) {
    var root = this.keyForAttribute(primaryType.typeKey),
        partials = payload[pluralize(root)];

    forEach(partials, function(partial) {
      updatePayloadWithEmbedded(this, store, primaryType, payload, partial);
    }, this);

    return this._super(store, primaryType, payload);
  }
});

// checks config for attrs option to embedded (always) - serialize and deserialize
function hasEmbeddedAlwaysOption(attrs, attr) {
  var option = attrsOption(attrs, attr);
  return option && option.embedded === 'always';
}

// checks config for attrs option to serialize ids
function hasSerializeRecordsOption(attrs, attr) {
  var alwaysEmbed = hasEmbeddedAlwaysOption(attrs, attr);
  var option = attrsOption(attrs, attr);
  return alwaysEmbed || (option && (option.serialize === 'records'));
}

// checks config for attrs option to serialize records
function hasSerializeIdsOption(attrs, attr) {
  var option = attrsOption(attrs, attr);
  return option && (option.serialize === 'ids' || option.serialize === 'id');
}

// checks config for attrs option to serialize records
function noSerializeOptionSpecified(attrs, attr) {
  var option = attrsOption(attrs, attr);
  var serializeRecords = hasSerializeRecordsOption(attrs, attr);
  var serializeIds = hasSerializeIdsOption(attrs, attr);
  return !(option && (option.serialize || option.embedded));
}

// checks config for attrs option to deserialize records
// a defined option object for a resource is treated the same as
// `deserialize: 'records'`
function hasDeserializeRecordsOption(attrs, attr) {
  var alwaysEmbed = hasEmbeddedAlwaysOption(attrs, attr);
  var option = attrsOption(attrs, attr);
  var hasSerializingOption = option && (option.deserialize || option.serialize);
  return alwaysEmbed || hasSerializingOption /* option.deserialize === 'records' */;
}

function attrsOption(attrs, attr) {
  return attrs && (attrs[Ember.String.camelize(attr)] || attrs[attr]);
}

// chooses a relationship kind to branch which function is used to update payload
// does not change payload if attr is not embedded
function updatePayloadWithEmbedded(serializer, store, type, payload, partial) {
  var attrs = get(serializer, 'attrs');

  if (!attrs) {
    return;
  }
  type.eachRelationship(function(key, relationship) {
    if (hasDeserializeRecordsOption(attrs, key)) {
      if (relationship.kind === "hasMany") {
        updatePayloadWithEmbeddedHasMany(serializer, store, key, relationship, payload, partial);
      }
      if (relationship.kind === "belongsTo") {
        updatePayloadWithEmbeddedBelongsTo(serializer, store, key, relationship, payload, partial);
      }
    }
  });
}

// handles embedding for `hasMany` relationship
function updatePayloadWithEmbeddedHasMany(serializer, store, primaryType, relationship, payload, partial) {
  var embeddedSerializer = store.serializerFor(relationship.type.typeKey);
  var primaryKey = get(serializer, 'primaryKey');
  var attr = relationship.type.typeKey;
  // underscore forces the embedded records to be side loaded.
  // it is needed when main type === relationship.type
  var embeddedTypeKey = '_' + serializer.typeForRoot(relationship.type.typeKey);
  var expandedKey = serializer.keyForRelationship(primaryType, relationship.kind);
  var attribute  = serializer.keyForAttribute(primaryType);
  var ids = [];

  if (!partial[attribute]) {
    return;
  }

  payload[embeddedTypeKey] = payload[embeddedTypeKey] || [];

  forEach(partial[attribute], function(data) {
    var embeddedType = store.modelFor(attr);
    updatePayloadWithEmbedded(embeddedSerializer, store, embeddedType, payload, data);
    ids.push(data[primaryKey]);
    payload[embeddedTypeKey].push(data);
  });

  partial[expandedKey] = ids;
  delete partial[attribute];
}

// handles embedding for `belongsTo` relationship
function updatePayloadWithEmbeddedBelongsTo(serializer, store, primaryType, relationship, payload, partial) {
  var attrs = serializer.get('attrs');

  if (!attrs ||
    !(hasDeserializeRecordsOption(attrs, Ember.String.camelize(primaryType)) ||
      hasDeserializeRecordsOption(attrs, primaryType))) {
    return;
  }
  var attr = relationship.type.typeKey;
  var _serializer = store.serializerFor(relationship.type.typeKey);
  var primaryKey = get(_serializer, 'primaryKey');
  var embeddedTypeKey = Ember.String.pluralize(attr); // TODO don't use pluralize
  var expandedKey = _serializer.keyForRelationship(primaryType, relationship.kind);
  var attribute = _serializer.keyForAttribute(primaryType);

  if (!partial[attribute]) {
    return;
  }
  payload[embeddedTypeKey] = payload[embeddedTypeKey] || [];
  var embeddedType = store.modelFor(relationship.type.typeKey);
  for (var key in partial) {
    if (partial.hasOwnProperty(key) && camelize(key) === attr) {
      updatePayloadWithEmbedded(_serializer, store, embeddedType, payload, partial[key]);
    }
  }
  partial[expandedKey] = partial[attribute].id;
  // Need to move an embedded `belongsTo` object into a pluralized collection
  payload[embeddedTypeKey].push(partial[attribute]);
  // Need a reference to the parent so relationship works between both `belongsTo` records
  partial[attribute][relationship.parentType.typeKey + '_id'] = partial.id;
  delete partial[attribute];
}

export default EmbeddedRecordsMixin;
