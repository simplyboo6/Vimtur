import { Db, MongoClient } from 'mongodb';
import { describe, it } from 'mocha';
import { expect } from 'chai';

import { Database } from '../types/database';
import { MongoConnector } from '../database/mongodb';
import Config from '../config';

describe('Database Tests', () => {
  let database: Database;
  let connection: MongoClient;
  let mongo: Db;

  before(async () => {
    database = await MongoConnector.init();

    const config = Config.get().database;
    connection = await MongoClient.connect(config.uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    const dbName = Config.get().database.db;
    mongo = connection.db(dbName);
  });

  describe('Basic playlist tests', () => {
    it('Create playlist', async () => {
      const playlist = await database.addPlaylist({
        name: 'Playlist A',
      });
      expect(playlist.id).to.be.a('string');
      expect(playlist.size).to.equal(0);
      expect(playlist.name).to.equal('Playlist A');
    });

    it('Create and get playlist', async () => {
      const playlist = await database.addPlaylist({
        name: 'Playlist A',
      });
      expect(playlist.id).to.be.a('string');

      const fetched = await database.getPlaylist(playlist.id);
      expect(fetched).to.deep.equal(playlist);
    });

    it('Create and update playlist', async () => {
      const playlistA = await database.addPlaylist({
        name: 'Playlist A',
      });
      expect(playlistA.id).to.be.a('string');

      const playlistB = await database.addPlaylist({
        name: 'Playlist B',
      });
      expect(playlistB.id).to.be.a('string');

      await database.updatePlaylist(playlistA.id, { name: 'Playlist A2' });

      const fetchedA = await database.getPlaylist(playlistA.id);
      const fetchedB = await database.getPlaylist(playlistB.id);

      expect(fetchedA).to.be.an('object');

      expect(fetchedA!.name).to.equal('Playlist A2');
      // Ensure playlist B is untouched.
      expect(fetchedB).to.deep.equal(playlistB);
    });

    it('Create and delete playlist', async () => {
      const playlist = await database.addPlaylist({
        name: 'Playlist A',
      });

      await database.removePlaylist(playlist.id);

      const fetched = await database.getPlaylist(playlist.id);
      expect(fetched).to.equal(undefined);
    });

    it('Create and list playlists', async () => {
      const playlistA = await database.addPlaylist({
        name: 'Playlist A',
      });
      const playlistB = await database.addPlaylist({
        name: 'Playlist B',
      });
      const playlistC = await database.addPlaylist({
        name: 'Playlist C',
      });

      const playlists = await database.getPlaylists();
      expect(playlists.length).to.equal(3);
      expect(playlists.find(playlist => playlist.id === playlistA.id)).to.be.an('object');
      expect(playlists.find(playlist => playlist.id === playlistB.id)).to.be.an('object');
      expect(playlists.find(playlist => playlist.id === playlistC.id)).to.be.an('object');
    });

    it('Ensure correct item is removed', async () => {
      const playlistA = await database.addPlaylist({
        name: 'Playlist A',
      });
      const playlistB = await database.addPlaylist({
        name: 'Playlist B',
      });
      const playlistC = await database.addPlaylist({
        name: 'Playlist C',
      });
      const playlists = await database.getPlaylists();
      expect(playlists.length).to.equal(3);

      await database.removePlaylist(playlistB.id);

      const playlistsPost = await database.getPlaylists();

      expect(playlistsPost.length).to.equal(2);
      expect(playlistsPost.find(playlist => playlist.id === playlistA.id)).to.be.an('object');
      expect(playlistsPost.find(playlist => playlist.id === playlistB.id)).to.equal(undefined);
      expect(playlistsPost.find(playlist => playlist.id === playlistC.id)).to.be.an('object');
    });

    afterEach(async () => {
      await mongo.collection('playlists').deleteMany({});
    });
  });

  after(async () => {
    await database.close();
    await connection.close();
  });
});
