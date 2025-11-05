#!/usr/bin/env python

"""
 * @file dbClean.py
 * Used in CS498RK MP4 to empty database of all users and tasks.
 *
 * @author Aswin Sivaraman
 * @date Created: Spring 2015
 * @date Modified: Spring 2015
 * @date Modified: Spring 2019
"""

import sys
import getopt
import http.client
import urllib
import json

def usage():
    print('dbClean.py -u <baseurl> -p <port>')

def getUsers(conn):
    # build ?filter={"_id":1} but URL-encoded
    params = urllib.parse.urlencode({
        'filter': json.dumps({"_id": 1})
    })
    conn.request("GET", f"/api/users?{params}", headers={"Accept": "application/json"})
    response = conn.getresponse()
    data = response.read()
    d = json.loads(data)

    return [str(doc['_id']) for doc in d['data']]

def getTasks(conn):
    params = urllib.parse.urlencode({
        'filter': json.dumps({"_id": 1})
    })
    conn.request("GET", f"/api/tasks?{params}", headers={"Accept": "application/json"})
    response = conn.getresponse()
    data = response.read()
    d = json.loads(data)

    return [str(doc['_id']) for doc in d['data']]

def main(argv):

    # Server Base URL and port
    baseurl = "localhost"
    port = 4000

    try:
        opts, args = getopt.getopt(argv,"hu:p:",["url=","port="])
    except getopt.GetoptError:
        usage()
        sys.exit(2)
    for opt, arg in opts:
        if opt == '-h':
             usage()
             sys.exit()
        elif opt in ("-u", "--url"):
             baseurl = str(arg)
        elif opt in ("-p", "--port"):
             port = int(arg)

    # Server to connect to (1: url, 2: port number)
    conn = http.client.HTTPConnection(baseurl, port)

    # Fetch a list of users
    users = getUsers(conn)

    # Loop for as long as the database still returns users
    while len(users):

        # Delete each individual user
        for user in users:
            conn.request("DELETE","/api/users/"+user)
            response = conn.getresponse()
            data = response.read()

        # Fetch a list of users
        users = getUsers(conn)

    # Fetch a list of tasks
    tasks = getTasks(conn)

    # Loop for as long as the database still returns tasks
    while len(tasks):

        # Delete each individual task
        for task in tasks:
            conn.request("DELETE","/api/tasks/"+task)
            response = conn.getresponse()
            data = response.read()

        # Fetch a list of tasks
        tasks = getTasks(conn)

    # Exit gracefully
    conn.close()
    print("All users and tasks removed at "+baseurl+":"+str(port))


if __name__ == "__main__":
     main(sys.argv[1:])
