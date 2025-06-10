const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const Member = require('./models/member');
const Book = require('./models/book');
const Borrowing = require('./models/borrowing');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const secret = '87654321';
const cors = require('cors');

const typeDefs = gql`
  type Book {
    id: ID!
    title: String!
    author: String!
    isbn: String!
    availableCopies: Int!
    category: String
  }

  type Member {
    id: ID!
    name: String!
    email: String!
    membershipNumber: String!
    joinDate: String!
    borrowings: [Borrowing!]!
  }

  type Borrowing {
    id: ID!
    book: Book!
    member: Member!
    borrowDate: String!
    returnDate: String
    returned: Boolean!
  }

  type AuthPayload {
    token: String!
    member: Member!
  }

  input createBookInput {
    title: String!
    author: String!
    isbn: String!
    copies: Int!
    category: String
  }

  input createMemberInput {
    name: String!
    email: String!
    password: String!
  }

  type Query {
    me: Member
    getMembers: [Member!]!
    getMember(id: ID!): Member
    getMemberByEmail(email: String!): Member
    books: [Book!]!
    book(id: ID!): Book
    availableBooks: [Book!]!
  }

  type Mutation {
    registerMember(input: createMemberInput!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    addBook(input: createBookInput!): Book!
    borrowBook(bookId: ID!): Borrowing!
    returnBook(borrowingId: ID!): Borrowing!
  }
`;

const bookQueries = {
  books: async () => {
    const books = await Book.find();
    return books;
  },
  book: async (_, { id }) => {
    const book = await Book.findById(id);
    return book;
  },
  availableBooks: async () => {
    const books = await Book.find({ availableCopies: { $gt: 0 } });
    return books;
  },
};

const memberQueries = {
  me: async (_, __, context) => {
    const member = await Member.findById(context.userId);
    return member;
  },
  getMembers: async () => {
    return await Member.find();
  },
  getMember: async (_, { id }) => {
    const member = await Member.findById(id);
    return member;
  },
  getMemberByEmail: async (_, { email }) => {
    const member = await Member.findOne({ email });
    return member;
  },
};

const memberMutations = {
  registerMember: async (_, { input }) => {
    const { name, email, password } = input;
    // Check if member already exists
    const existingMember = await Member.findOne({ email });
    if (existingMember) {
      throw new Error('Email already registered');
    }

    // Generate membership number (you can customize this format)
    const membershipNumber = `MEM${Date.now().toString().slice(-6)}`;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new member
    const member = await Member.create({
      name,
      email,
      password: hashedPassword,
      membershipNumber,
      joinDate: new Date().toISOString(),
    });

    // Generate token
    const token = jwt.sign({ userId: member.id }, secret);

    return {
      token,
      member,
    };
  },

  login: async (_, { email, password }) => {
    // Find member
    const member = await Member.findOne({ email });
    if (!member) {
      throw new Error('Invalid credentials');
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, member.password);
    if (!validPassword) {
      throw new Error('Invalid credentials');
    }

    // Generate token
    const token = jwt.sign({ userId: member.id }, secret);

    return {
      token,
      member,
    };
  },
};

const bookMutations = {
  addBook: async (_, { input }, context) => {
    if (!context.userId) {
      throw new Error('Not authenticated');
    }

    // Check if book already exists
    const existingBook = await Book.findOne({ isbn: input.isbn });
    if (existingBook) {
      throw new Error('Book with this ISBN already exists');
    }

    // Create new book
    const book = await Book.create(input);

    return book;
  },

  borrowBook: async (_, { bookId }, context) => {
    if (!context.userId) {
      throw new Error('Not authenticated');
    }

    // Find book and check availability
    const book = await Book.findById(bookId);
    if (!book) {
      throw new Error('Book not found');
    }
    if (book.availableCopies <= 0) {
      throw new Error('No copies available');
    }

    // Check if member has already borrowed this book
    const existingBorrowing = await Borrowing.findOne({
      member: context.userId,
      book: bookId,
      returned: false,
    });

    if (existingBorrowing) {
      throw new Error('Member has already borrowed this book');
    }

    // Create borrowing record
    const borrowing = await Borrowing.findOne({
      member: context.userId,
      book: bookId,
      returned: false,
    });

    if (borrowing) {
      throw new Error('Member has already borrowed this book');
    }

    // Create borrowing record
    const newBorrowing = await Borrowing.create({
      book: bookId,
      member: context.userId,
      borrowDate: new Date().toISOString(),
      returned: false,
    });

    // Update book copies
    book.availableCopies -= 1;
    await book.save();

    // Populate references
    const populatedBorrowing = await Borrowing.findById(newBorrowing._id)
      .populate('book')
      .populate('member');

    return populatedBorrowing;
  },

  returnBook: async (_, { borrowingId }, context) => {
    if (!context.userId) {
      throw new Error('Not authenticated');
    }

    // Find borrowing record
    const borrowing = await Borrowing.findById(borrowingId);
    if (!borrowing) {
      throw new Error('Borrowing record not found');
    }

    // Check if book is already returned
    if (borrowing.returned) {
      throw new Error('Book already returned');
    }

    // Update borrowing record
    borrowing.returned = true;
    borrowing.returnDate = new Date().toISOString();
    await borrowing.save();

    // Increase available copies
    const book = await Book.findById(borrowing.book);
    book.availableCopies += 1;
    await book.save();

    return borrowing;
  },
};

const resolvers = {
  Query: {
    ...bookQueries,
    ...memberQueries,
  },
  Mutation: {
    ...memberMutations,
    ...bookMutations,
  },
  Member: {
    borrowings: async (parent) => {
      return await Borrowing.find({ member: parent._id }).populate('book');
    },
  },
};

async function startApolloServer() {
  const app = express();
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => {
      const token = req.headers.authorization || '';
      let userId = null;

      if (token && token.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(token.split(' ')[1], secret);
          userId = decoded.userId;
        } catch (err) {
          console.error('Invalid token');
        }
      }

      return { userId };
    },

    introspection: true,
    playground: true,
  });

  await mongoose.connect('mongodb://localhost:27017/library');
  await server.start();

  server.applyMiddleware({ app });

  app.use(cors());

  app.listen({ port: 4000 }, () => {
    console.log('GraphQL server is listening on port 4000');
  });
}

startApolloServer();
