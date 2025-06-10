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

// Custom error class for better error handling
class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const typeDefs = gql`
  enum Category {
    FICTION
    NON_FICTION
    SCIENCE
    TECHNOLOGY
    HISTORY
  }

  type Book {
    id: ID!
    title: String!
    author: String!
    isbn: String!
    availableCopies: Int!
    category: Category
    totalCopies: Int!
  }

  type Member {
    id: ID!
    name: String!
    email: String!
    membershipNumber: String!
    joinDate: String!
    borrowings: [Borrowing!]!
    activeBorrowings: [Borrowing!]!
  }

  type Borrowing {
    id: ID!
    book: Book!
    member: Member!
    borrowDate: String!
    returnDate: String
    returned: Boolean!
    daysOverdue: Int
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
    searchBooks(query: String!): [Book!]!
    filteredBooks(category: Category): [Book!]!
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
    try {
      const books = await Book.find();
      return books;
    } catch (error) {
      throw new AppError('Failed to fetch books', 'FETCH_BOOKS_ERROR');
    }
  },

  book: async (_, { id }) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError('Invalid book ID', 'INVALID_ID');
      }
      const book = await Book.findById(id);
      if (!book) {
        throw new AppError('Book not found', 'BOOK_NOT_FOUND');
      }
      return book;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch book', 'FETCH_BOOK_ERROR');
    }
  },

  availableBooks: async () => {
    try {
      const books = await Book.find({ availableCopies: { $gt: 0 } });
      return books;
    } catch (error) {
      throw new AppError(
        'Failed to fetch available books',
        'FETCH_AVAILABLE_BOOKS_ERROR'
      );
    }
  },

  searchBooks: async (_, { query }) => {
    try {
      const books = await Book.find({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { author: { $regex: query, $options: 'i' } },
        ],
      });
      return books;
    } catch (error) {
      throw new AppError('Failed to search books', 'SEARCH_BOOKS_ERROR');
    }
  },

  filteredBooks: async (_, { category }) => {
    try {
      const books = await Book.find({ category });
      return books;
    } catch (error) {
      throw new AppError(
        'Failed to fetch filtered books',
        'FETCH_FILTERED_BOOKS_ERROR'
      );
    }
  },
};

const memberQueries = {
  me: async (_, __, context) => {
    try {
      if (!context.userId) {
        throw new AppError('Not authenticated', 'UNAUTHENTICATED');
      }
      const member = await Member.findById(context.userId);
      if (!member) {
        throw new AppError('Member not found', 'MEMBER_NOT_FOUND');
      }
      return member;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Failed to fetch member profile',
        'FETCH_PROFILE_ERROR'
      );
    }
  },

  getMembers: async () => {
    try {
      return await Member.find();
    } catch (error) {
      throw new AppError('Failed to fetch members', 'FETCH_MEMBERS_ERROR');
    }
  },

  getMember: async (_, { id }) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError('Invalid member ID', 'INVALID_ID');
      }
      const member = await Member.findById(id);
      if (!member) {
        throw new AppError('Member not found', 'MEMBER_NOT_FOUND');
      }
      return member;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch member', 'FETCH_MEMBER_ERROR');
    }
  },

  getMemberByEmail: async (_, { email }) => {
    try {
      if (!email || !email.includes('@')) {
        throw new AppError('Invalid email format', 'INVALID_EMAIL');
      }
      const member = await Member.findOne({ email });
      if (!member) {
        throw new AppError('Member not found', 'MEMBER_NOT_FOUND');
      }
      return member;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Failed to fetch member by email',
        'FETCH_MEMBER_ERROR'
      );
    }
  },
};

const memberMutations = {
  registerMember: async (_, { input }) => {
    try {
      const { name, email, password } = input;

      // Validate input
      if (!name || !email || !password) {
        throw new AppError('All fields are required', 'INVALID_INPUT');
      }
      if (!email.includes('@')) {
        throw new AppError('Invalid email format', 'INVALID_EMAIL');
      }
      if (password.length < 6) {
        throw new AppError(
          'Password must be at least 6 characters',
          'INVALID_PASSWORD'
        );
      }

      // Check if member already exists
      const existingMember = await Member.findOne({ email });
      if (existingMember) {
        throw new AppError('Email already registered', 'EMAIL_EXISTS');
      }

      // Generate membership number
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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to register member', 'REGISTRATION_ERROR');
    }
  },

  login: async (_, { email, password }) => {
    try {
      // Validate input
      if (!email || !password) {
        throw new AppError('Email and password are required', 'INVALID_INPUT');
      }

      // Find member
      const member = await Member.findOne({ email });
      if (!member) {
        throw new AppError('Invalid credentials', 'INVALID_CREDENTIALS');
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, member.password);
      if (!validPassword) {
        throw new AppError('Invalid credentials', 'INVALID_CREDENTIALS');
      }

      // Generate token
      const token = jwt.sign({ userId: member.id }, secret);

      return {
        token,
        member,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to login', 'LOGIN_ERROR');
    }
  },
};

const bookMutations = {
  addBook: async (_, { input }, context) => {
    try {
      if (!context.userId) {
        throw new AppError('Not authenticated', 'UNAUTHENTICATED');
      }

      const { title, author, isbn, copies, category } = input;

      // Validate input
      if (!title || !author || !isbn || !copies) {
        throw new AppError('Required fields missing', 'INVALID_INPUT');
      }
      if (copies < 1) {
        throw new AppError(
          'Number of copies must be positive',
          'INVALID_COPIES'
        );
      }

      // Check if book already exists
      const existingBook = await Book.findOne({ isbn });
      if (existingBook) {
        throw new AppError('Book with this ISBN already exists', 'ISBN_EXISTS');
      }

      // Create new book
      const book = await Book.create({
        ...input,
        availableCopies: copies,
        totalCopies: copies,
      });

      return book;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to add book', 'ADD_BOOK_ERROR');
    }
  },

  borrowBook: async (_, { bookId }, context) => {
    try {
      if (!context.userId) {
        throw new AppError('Not authenticated', 'UNAUTHENTICATED');
      }

      if (!mongoose.Types.ObjectId.isValid(bookId)) {
        throw new AppError('Invalid book ID', 'INVALID_ID');
      }

      // Find book and check availability
      const book = await Book.findById(bookId);
      if (!book) {
        throw new AppError('Book not found', 'BOOK_NOT_FOUND');
      }
      if (book.availableCopies <= 0) {
        throw new AppError('No copies available', 'NO_COPIES_AVAILABLE');
      }

      // Check if member has already borrowed this book
      const existingBorrowing = await Borrowing.findOne({
        member: context.userId,
        book: bookId,
        returned: false,
      });

      if (existingBorrowing) {
        throw new AppError(
          'Member has already borrowed this book',
          'ALREADY_BORROWED'
        );
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

      return newBorrowing;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to borrow book', 'BORROW_BOOK_ERROR');
    }
  },

  returnBook: async (_, { borrowingId }, context) => {
    try {
      if (!context.userId) {
        throw new AppError('Not authenticated', 'UNAUTHENTICATED');
      }

      if (!mongoose.Types.ObjectId.isValid(borrowingId)) {
        throw new AppError('Invalid borrowing ID', 'INVALID_ID');
      }

      // Find borrowing record
      const borrowing = await Borrowing.findById(borrowingId);
      if (!borrowing) {
        throw new AppError('Borrowing record not found', 'BORROWING_NOT_FOUND');
      }

      // Check if the borrowing belongs to the current user
      if (borrowing.member.toString() !== context.userId) {
        throw new AppError(
          'Not authorized to return this book',
          'UNAUTHORIZED'
        );
      }

      // Check if book is already returned
      if (borrowing.returned) {
        throw new AppError('Book already returned', 'ALREADY_RETURNED');
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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to return book', 'RETURN_BOOK_ERROR');
    }
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
  // Feild resolvers
  // Member
  Member: {
    borrowings: async (parent) => {
      try {
        return await Borrowing.find({ member: parent._id })
          .populate('book')
          .sort({ borrowDate: -1 });
      } catch (error) {
        throw new AppError(
          'Failed to fetch borrowings',
          'FETCH_BORROWINGS_ERROR'
        );
      }
    },
    activeBorrowings: async (parent) => {
      try {
        return await Borrowing.find({ member: parent._id, returned: false })
          .populate('book')
          .sort({ borrowDate: -1 });
      } catch (error) {
        throw new AppError(
          'Failed to fetch active borrowings',
          'FETCH_ACTIVE_BORROWINGS_ERROR'
        );
      }
    },
  },
  // Borrowing
  Borrowing: {
    book: async (parent) => {
      return await Book.findById(parent.book);
    },
    member: async (parent) => {
      return await Member.findById(parent.member);
    },
    daysOverdue: (parent) => {
      if (!parent.returned) {
        const borrowDate = new Date(parent.borrowDate);
        const today = new Date();
        const diffTime = Math.abs(today - borrowDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 14 ? diffDays - 14 : 0;
      }
      return 0;
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
    formatError: (error) => {
      const originalError = error.originalError;
      if (originalError instanceof AppError) {
        return {
          message: originalError.message,
          code: originalError.code,
        };
      }
      return {
        message: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
      };
    },
    introspection: true,
    playground: true,
  });

  try {
    await mongoose.connect('mongodb://localhost:27017/library', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }

  await server.start();
  server.applyMiddleware({ app });
  app.use(cors());

  app.listen({ port: 4000 }, () => {
    console.log('GraphQL server is listening on port 4000');
  });
}

startApolloServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
