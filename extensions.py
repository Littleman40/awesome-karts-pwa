from flask_pymongo import PyMongo

mongo = PyMongo()                      # avoids circular imports by creating the mongo obj here and allowing other files to import it instead of from each other
