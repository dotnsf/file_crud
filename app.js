//. app.js

var express = require( 'express' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    fs = require( 'fs' ),
    ejs = require( 'ejs' ),
    cloudantlib = require( '@cloudant/cloudant' ),
    app = express();
var settings = require( './settings' );
var cloudant = null;
if( settings.db_apikey && settings.db_url ){
  cloudant = new cloudantlib({
    url: settings.db_url,
    plugins: {
      iamauth: {
        iamApikey: settings.db_apikey
      }
    }
  });
}else if( settings.cloudant_username && settings.cloudant_password ){
  cloudant = cloudantlib( { account: settings.cloudant_username, password: settings.cloudant_password } );
}

var db = null;
var db_url = ( settings.db_url ? settings.db_url : 'https://' + settings.cloudant_username + '.cloudant.com/database/' + settings.cloudant_dbname + '/_all_docs' );
if( cloudant ){
  cloudant.db.get( settings.cloudant_dbname, function( err, body ){
    if( err ){
      if( err.statusCode == 404 ){
        cloudant.db.create( settings.cloudant_dbname, function( err, body ){
          if( err ){
            db = null;
          }else{
            db = cloudant.db.use( settings.cloudant_dbname );

            insertIndex();
          }
        });
      }else{
        db = cloudant.db.use( settings.cloudant_dbname );

        insertIndex();
      }
    }else{
      db = cloudant.db.use( settings.cloudant_dbname );

      insertIndex();
    }
  });
}

app.use( multer( { dest: './tmp/' } ).single( 'file' ) );
app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/views' );
app.set( 'view engine', 'ejs' );

app.get( '/', function( req, res ){
  res.render( 'index', {} );
});


var typename = 'item';

app.post( '/item', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var params = ( req.body ? req.body : {} ); //. { user_id: 'xx', text: '', .. }
  params.type = typename;
  var ts = ( new Date() ).getTime();
  params.created = ts;
  params.updated = ts;
  if( db ){
    if( req.file && req.file.path ){
      var filepath = req.file.path;
      var filetype = req.file.mimetype;
      var fileoriginalname = req.file.originalname;
      var bin = fs.readFileSync( filepath );
      var bin64 = new Buffer( bin ).toString( 'base64' );
        
      params.file_content_type = filetype;
      params.filename = fileoriginalname;
      params['_attachments'] = {
        file: {
          content_type: filetype,
          data: bin64
        }
      };
    }

    db.insert( params, function( err, body, header ){
      if( req.file && req.file.path ){
        fs.unlink( req.file.path, function( err ){} );
      }
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err } ) );
        res.end();
      }else{
        res.write( JSON.stringify( { status: true, body: body } ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.get( '/items', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;

  if( db ){
    db.list( { include_docs: true }, function( err, body, header ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err } ) );
        res.end();
      }else{
        var total = body.total_rows;
        var items = [];
        body.rows.forEach( function( _item ){
          var item = JSON.parse( JSON.stringify( _item.doc ) );
          if( item.type && item.type == typename ){
            items.push( item );
          }
        });

        if( offset || limit ){
          if( offset + limit > total ){
            items = items.slice( offset );
          }else{
            items = items.slice( offset, offset + limit );
          }
        }

        res.write( JSON.stringify( { status: true, limit: limit, offset: offset, total: total, items: items } ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.get( '/item/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;
    if( id ){
      db.get( id, { include_docs: true }, function( err, item, header ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true, item: item } ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'parameter id required.' } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.get( '/attachment/:id', function( req, res ){
  if( db ){
    var id = req.params.id;
    if( id ){
      db.get( id, { include_docs: true }, function( err, item, header ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var file_content_type = item.file_content_type;
          db.attachment.get( id, "file", function( err, body ){
            if( err ){
              res.contentType( 'application/json; charset=utf-8' );
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              if( file_content_type ){
                res.contentType( file_content_type );
              }
              res.end( body, 'binary' );
            }
          });
        }
      });
    }else{
      res.contentType( 'application/json; charset=utf-8' );
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'parameter id required.' } ) );
      res.end();
    }
  }else{
    res.contentType( 'application/json; charset=utf-8' );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.get( '/download/:id', function( req, res ){
  if( db ){
    var id = req.params.id;
    if( id ){
      db.get( id, { include_docs: true }, function( err, item, header ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          db.attachment.get( id, "file", function( err, body ){
            if( err ){
              res.contentType( 'application/json; charset=utf-8' );
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              //res.contentType( 'application/force-download' );
              res.contentType( 'application/force-octet-stream' );
              res.setHeader( 'Content-Disposition', 'attachment; filename="' + item.filename + '"' );
              res.end( body, 'binary' );
            }
          });
        }
      });
    }else{
      res.contentType( 'application/json; charset=utf-8' );
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'parameter id required.' } ) );
      res.end();
    }
  }else{
    res.contentType( 'application/json; charset=utf-8' );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.put( '/item/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;
    if( id ){
      db.get( id, { include_docs: true }, function( err, item, header ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var body = req.body;
          Object.keys( body ).forEach( function( key ){
            item[key] = body[key];
          });

          var ts = ( new Date() ).getTime();
          item.updated = ts;
          //delete item['file_content_type'];
          //delete item['filename'];

          if( req.file && req.file.path ){
            var filepath = req.file.path;
            var filetype = req.file.mimetype;
            var fileoriginalname = req.file.originalname;
            var bin = fs.readFileSync( filepath );
            var bin64 = new Buffer( bin ).toString( 'base64' );
            
            item.file_content_type = filetype;
            item.filename = fileoriginalname;
            item['_attachments'] = {
              file: {
                content_type: filetype,
                data: bin64
              }
            };
          }

          db.insert( item, function( err, body, header ){
            if( req.file && req.file.path ){
              fs.unlink( req.file.path, function( err ){} );
            }
            if( err ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              res.write( JSON.stringify( { status: true, body: body } ) );
              res.end();
            }
          });
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'parameter id required.' } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.delete( '/item/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;
    if( id ){
      db.get( id, {}, function( err, item, header ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var rev = item._rev;
          db.destroy( id, rev, function( err, body, header ){
            if( err ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              res.write( JSON.stringify( { status: true, id: id } ) );
              res.end();
            }
          });
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'parameter id required.' } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.post( '/search', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var q = req.body.q;
    if( q ){
      db.search( 'library', 'textSearch', { q: q, include_docs: true }, function( err, result ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true, results: result.rows } ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'parameter q required.' } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});

app.get( '/search/:q', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var q = req.params.q;
    if( q ){
      /*
      db.search( 'library', 'textSearch', { q: q, include_docs: true }, function( err, result ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true, results: result.rows } ) );
          res.end();
        }
      });
      */
      var query = {
        selector: {
          "$text": q
        },
        fields: [ "_id", "_rev", "text", "updated" ],
        use_index: "_design/search",
        sort: [ { "updated:number": "asc" } ]
      };
      db.find( query, function( err, result ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true, results: result.docs } ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'parameter q required.' } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db not initialized.' } ) );
    res.end();
  }
});


function timestamp2datetime( ts ){
  var dt = new Date( ts );
  var yyyy = dt.getFullYear();
  var mm = dt.getMonth() + 1;
  var dd = dt.getDate();
  var hh = dt.getHours();
  var nn = dt.getMinutes();
  var ss = dt.getSeconds();
  var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
    + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
  return datetime;
}

function insertIndex(){
  if( db ){
    //. query index
    var query_index_owner = {
      _id: "_design/library",
      language: "query",
      views: {
        //bytimestamp: {
        //  map: "function( doc ){ if( doc.updated ){ emit( doc.updated, doc ); } }"
        //}
      },
      indexes: {
        "user_id-index": {
          index: {
            fields: [ { name: "user_id", type: "string" } ]
          },
          type: "text"
        },
        "textSearch": {
          analyzer: "japanese", //{ name: "japanese" },
          index: function( doc ){ if( doc.text ){ index( "default", [doc.text].join( ' ' ) ); } } 
        }
      }
    };
    db.insert( query_index_owner, function( err, body ){
      if( err ){
        //console.log( JSON.stringify( err, null, 2 ) );
      }
    });

    //. https://qiita.com/MahoTakara/items/80392aafba8600877314 を試してみる！
    var fulltext_search_index = {
      _id: "_design/search",
      type: "text",
      name: "index-fulltext",
      ddoc: "index-text",
      index: {
        fields: [
          { name: "text", type: "string" },
          { name: "updated", type: "number" }
        ],
        default_field: {
          enabled: true,
          analyzer: 'cjk'
        }
      }
    };
    db.insert( fulltext_search_index, function( err, body ){
      if( err ){
        //console.log( JSON.stringify( err, null, 2 ) );
      }
    });

  }
}


var port = process.env.port || 8080;
app.listen( port );
console.log( "server stating on " + port + " ..." );
console.log( "DB: " + db_url + ' (' + settings.cloudant_password + ')' );
